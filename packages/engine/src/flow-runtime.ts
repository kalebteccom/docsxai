// Flow-file runtime — the deterministic execution side.
//
// `site-docs run` translates a parsed flow-file into a sequence of browser actions, executes
// them headlessly with zero LLM involvement, re-captures screenshots, and re-emits the doc-pack
// artifacts (annotations, etc.). One canonical locator per step; execution halts on locator or
// success-criterion failure — drift is a signal to recalibrate, not to absorb (no fallbacks).
//
// The runtime is written against a thin {@link BrowserDriver} abstraction so it's testable
// without a real browser; the Playwright-backed driver lives in a separate module.

import {
  type AnnotationRecord,
  type AnnotationsFile,
  type BoundingBox,
  type FlowFile,
  type Step,
  type SuccessSpec,
  type WaitSpec,
} from "./doc-pack.js";
import { locatorRefName } from "./flow-file.js";

// ---------------------------------------------------------------------------
// BrowserDriver
// ---------------------------------------------------------------------------

/** What the runtime needs from a browser. Selectors passed here are already resolved (no `$ref`). */
export interface BrowserDriver {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string | null, key: string): Promise<void>;
  hover(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  setChecked(selector: string, checked: boolean): Promise<void>;

  waitForNetworkIdle(): Promise<void>;
  waitForLoad(): Promise<void>;
  waitForElementStable(selector: string): Promise<void>;
  waitForSelector(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;

  isVisible(selector: string): Promise<boolean>;
  urlMatches(pattern: string): Promise<boolean>;
  textContains(selector: string, text: string): Promise<boolean>;

  /** Bounding box of an element, in page pixels, if it exists. */
  boundingBox(selector: string): Promise<BoundingBox | null>;
  /** Capture a clean screenshot (no baked annotations) and return where it was written, relative to the doc pack. */
  screenshot(relPath: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FlowExecutionError extends Error {
  constructor(message: string, readonly stepId: string, readonly cause?: unknown) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

export interface RunFlowOptions {
  /** Resolve a locator name → selector. Defaults to the flow-file's own `locators` map. */
  resolveLocator?: (name: string) => string | undefined;
  /** Where screenshots are written, relative to the doc pack root. Default: `docs/<flow>/screenshots/<step>.png`. */
  screenshotPath?: (flow: string, stepId: string) => string;
  /** If false, skip screenshot/annotation capture (pure flow validation). Default: true. */
  captureDocs?: boolean;
}

export interface ExecutedStep {
  id: string;
  action: Step["action"];
  /** Resolved selector the action targeted, if any. */
  selector?: string;
  /** Screenshot path (relative to the doc pack), if one was captured for this step. */
  screenshot?: string;
}

export interface RunFlowResult {
  flow: string;
  steps: ExecutedStep[];
  annotations: AnnotationsFile;
}

const defaultScreenshotPath = (flow: string, stepId: string) => `docs/${flow}/screenshots/${stepId}.png`;

/** Resolve a `target` value (`$name` ref or inline selector) using the flow-file's locators (or a custom resolver). */
export function resolveTarget(value: string, flow: FlowFile, resolver?: RunFlowOptions["resolveLocator"]): string {
  const name = locatorRefName(value);
  if (!name) return value; // inline selector
  const resolved = (resolver ?? ((n: string) => flow.locators[n]))(name);
  if (resolved === undefined) {
    throw new Error(`unresolved locator $${name}`);
  }
  return resolved;
}

async function applyWait(driver: BrowserDriver, wait: WaitSpec, resolve: (v: string) => string): Promise<void> {
  if (typeof wait === "string") {
    if (wait === "network_idle") return driver.waitForNetworkIdle();
    if (wait === "load") return driver.waitForLoad();
    // element_stable without a selector is a no-op signal in this prototype; a real driver may track layout.
    return;
  }
  if ("timeout_ms" in wait) return driver.waitForTimeout(wait.timeout_ms);
  if ("selector" in wait) return driver.waitForSelector(resolve(wait.selector));
}

async function checkSuccess(
  driver: BrowserDriver,
  success: SuccessSpec,
  resolve: (v: string) => string,
  stepId: string,
): Promise<void> {
  if ("visible" in success) {
    if (!(await driver.isVisible(resolve(success.visible)))) {
      throw new FlowExecutionError(`expected ${success.visible} to be visible`, stepId);
    }
    return;
  }
  if ("hidden" in success) {
    if (await driver.isVisible(resolve(success.hidden))) {
      throw new FlowExecutionError(`expected ${success.hidden} to be hidden`, stepId);
    }
    return;
  }
  if ("url_matches" in success) {
    if (!(await driver.urlMatches(success.url_matches))) {
      throw new FlowExecutionError(`expected URL to match ${success.url_matches}`, stepId);
    }
    return;
  }
  if ("text_contains" in success) {
    const { selector, text } = success.text_contains;
    if (!(await driver.textContains(resolve(selector), text))) {
      throw new FlowExecutionError(`expected ${selector} to contain ${JSON.stringify(text)}`, stepId);
    }
  }
}

async function executeAction(driver: BrowserDriver, step: Step, selector: string | null): Promise<void> {
  switch (step.action) {
    case "navigate":
      if (!step.value) throw new FlowExecutionError("navigate requires `value` (path/URL)", step.id);
      return driver.goto(step.value);
    case "click":
      return driver.click(needSelector(selector, step));
    case "fill":
      if (step.value === undefined) throw new FlowExecutionError("fill requires `value`", step.id);
      return driver.fill(needSelector(selector, step), step.value);
    case "press":
      if (!step.value) throw new FlowExecutionError("press requires `value` (key)", step.id);
      return driver.press(selector, step.value);
    case "hover":
      return driver.hover(needSelector(selector, step));
    case "select":
      if (step.value === undefined) throw new FlowExecutionError("select requires `value` (option)", step.id);
      return driver.selectOption(needSelector(selector, step), step.value);
    case "check":
      return driver.setChecked(needSelector(selector, step), true);
    case "uncheck":
      return driver.setChecked(needSelector(selector, step), false);
    case "wait":
      return; // a bare `wait` step just runs its `wait_for`
  }
}

function needSelector(selector: string | null, step: Step): string {
  if (selector === null) throw new FlowExecutionError(`action "${step.action}" requires a \`target\``, step.id);
  return selector;
}

/**
 * Execute a flow-file against a {@link BrowserDriver}, re-capturing screenshots and emitting annotation records.
 * Deterministic: given the same site state and driver behaviour, produces the same result. Halts on the first
 * locator / success-criterion failure.
 */
export async function runFlow(flow: FlowFile, driver: BrowserDriver, opts: RunFlowOptions = {}): Promise<RunFlowResult> {
  const captureDocs = opts.captureDocs ?? true;
  const screenshotPathOf = opts.screenshotPath ?? defaultScreenshotPath;
  const resolve = (v: string) => resolveTarget(v, flow, opts.resolveLocator);

  const executed: ExecutedStep[] = [];
  const annotations: AnnotationRecord[] = [];

  for (const step of flow.steps) {
    const selector = step.target ? resolve(step.target) : null;
    try {
      await executeAction(driver, step, selector);
      if (step.wait_for) await applyWait(driver, step.wait_for, resolve);
      if (step.success) await checkSuccess(driver, step.success, resolve, step.id);
    } catch (e) {
      if (e instanceof FlowExecutionError) throw e;
      throw new FlowExecutionError(`step "${step.id}" (${step.action}) failed: ${(e as Error).message}`, step.id, e);
    }

    const ex: ExecutedStep = { id: step.id, action: step.action, ...(selector ? { selector } : {}) };
    if (captureDocs && step.annotation) {
      const shot = screenshotPathOf(flow.name, step.id);
      await driver.screenshot(shot);
      ex.screenshot = shot;
      const bbox = selector ? await driver.boundingBox(selector) : null;
      annotations.push({
        step: step.id,
        selector: selector ?? "",
        ...(bbox ? { bounding_box: bbox } : {}),
        copy: step.annotation.copy,
        ...(step.annotation.arrow ? { arrow_style: step.annotation.arrow } : {}),
      });
    }
    executed.push(ex);
  }

  return {
    flow: flow.name,
    steps: executed,
    annotations: { schema: "site-docs/annotations@1", flow: flow.name, annotations },
  };
}
