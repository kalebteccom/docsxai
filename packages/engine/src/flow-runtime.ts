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
  type RedactionRegion,
  type RedactionStyle,
  type Step,
  type SuccessSpec,
  type WaitSpec,
} from "./doc-pack.js";
import { locatorRefName } from "./flow-file.js";

// ---------------------------------------------------------------------------
// BrowserDriver
// ---------------------------------------------------------------------------

/**
 * A redaction with its locator ref already resolved to a concrete selector. `selector` entries are
 * turned into bounding boxes by the driver at capture time (absent/zero-box selectors are skipped
 * with a stderr warning — never a halt); `region` rects are in CSS pixels and the driver scales
 * them to the screenshot's device-pixel space.
 */
export type ResolvedRedaction =
  | { selector: string; style: RedactionStyle }
  | { region: RedactionRegion; style: RedactionStyle };

/** What the runtime needs from a browser. Selectors passed here are already resolved (no `$ref`). */
export interface BrowserDriver {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  upload(selector: string, filePath: string): Promise<void>;
  press(selector: string | null, key: string): Promise<void>;
  hover(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  setChecked(selector: string, checked: boolean): Promise<void>;

  waitForNetworkIdle(): Promise<void>;
  waitForLoad(): Promise<void>;
  waitForElementStable(selector: string): Promise<void>;
  /** Wait for `selector` to appear. `timeoutMs` overrides the driver's default (use for slow backend ops). */
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;

  isVisible(selector: string): Promise<boolean>;
  urlMatches(pattern: string): Promise<boolean>;
  textContains(selector: string, text: string): Promise<boolean>;

  // — context for richer halt messages —
  /** Current page URL. */
  currentUrl(): Promise<string>;
  /** How many elements `selector` matches (so a halt can say "0" vs "8 stale ones"). */
  count(selector: string): Promise<number>;
  /** Text content of the first match of `selector`, or `null`. */
  textOf(selector: string): Promise<string | null>;

  /** Bounding box of an element, in page pixels. Pass `timeoutMs` (default = driver default) so this fails fast when the target has vanished. Returns `null` on miss. */
  boundingBox(selector: string, timeoutMs?: number): Promise<BoundingBox | null>;
  /** Capture a clean screenshot (no baked annotations), applying any `redactions` before it hits disk. */
  screenshot(relPath: string, redactions?: ResolvedRedaction[]): Promise<void>;

  /**
   * Probe the actionability state of `selector` at write-time / calibration-time, without trying
   * to act on it. Returns one of {@link ActionableState}. Designed to mirror the same Playwright
   * actionability checks the runtime would hit at execution-time — so a calibration agent (or an
   * MCP browser bridge consuming this driver's contract) can decide "no point fill'ing a disabled
   * input" or "scope this selector with `:visible` — it matches multiple" *before* the step is
   * written into a flow-file. `timeoutMs` is the *budget per check*, not a wait — keep small
   * (≤500 ms) to avoid stalling calibration. The runtime itself doesn't call this on every step
   * (Playwright's per-action actionability already covers that); it's an exposed contract for
   * consumers that want to read the state without acting.
   */
  actionable(selector: string, timeoutMs?: number): Promise<ActionableState>;
}

/**
 * The contract `actionable()` returns. Mirrors Playwright's per-action actionability checks
 * + a couple of states Playwright either throws on (multiple matches) or surfaces awkwardly
 * (off-screen, covered). Listed in the order calibration usually cares about them.
 */
export type ActionableState =
  | "actionable" // ready to act
  | "not-found" // selector matched 0 elements
  | "multiple-matches" // selector matched > 1 element (strict-mode violation)
  | "detached" // matched, but not attached to the DOM
  | "not-visible" // hidden / 0-size / display:none / clipped to nothing
  | "off-screen" // visible CSS-wise but fully outside the viewport
  | "covered" // another element receives clicks at this element's bbox center
  | "disabled"; // disabled attribute / aria-disabled / not-enabled

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FlowExecutionError extends Error {
  constructor(
    message: string,
    readonly stepId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

/**
 * Best-effort 1-line cause extracted from a Playwright actionability log (or similar driver
 * error). Returns undefined when nothing matches — keeps the halt message short rather than
 * guessing. Surfaced as a `[cause]` prefix on the halt message so the agent doesn't have to
 * scan the multi-line actionability log.
 */
export function inferHaltCause(rawError: string): string | undefined {
  const hints: Array<[RegExp, string]> = [
    [/element is disabled\b/i, "target is disabled"],
    [/element is not enabled\b/i, "target is not enabled"],
    [
      /element is not visible\b/i,
      "target is not visible (display:none / visibility:hidden / zero-sized)",
    ],
    [
      /element is not attached\b/i,
      "target was detached from the DOM (likely unmounted by an earlier action)",
    ],
    [/element is outside of the viewport\b/i, "target is outside the visible viewport"],
    [/element is not stable\b/i, "target is animating / not yet stable"],
    [/intercepts? pointer events\b/i, "target is covered by another element"],
    [
      /strict mode violation\b/i,
      "selector matched multiple elements (strict-mode violation) — scope with :visible / :nth-match",
    ],
    [
      /timeout .* exceeded.*waiting for/is,
      "timeout waiting for selector — element didn't appear in time (consider raising timeout_ms or revisiting the locator)",
    ],
  ];
  for (const [re, msg] of hints) {
    if (re.test(rawError)) return msg;
  }
  const resolved = rawError.match(/locator resolved to (<[^>\n]*>)/);
  if (resolved) return `target resolved to ${resolved[1]}`;
  return undefined;
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
  /** If set, stop after executing the step with this id — run only a prefix of the flow (for calibration). */
  stopAfter?: string;
  /**
   * If set, **skip** every step *before* the one with this id — start executing from this step onward.
   * Assumes the browser is already in the state the prior steps would have produced (typical use:
   * paired with `connectOverCdp` to attach to a Chrome that's already been driven there manually or
   * by an earlier partial run). The skipped steps emit no annotations / screenshots / executed records;
   * the caller is responsible for preserving the previous run's artifacts for them.
   */
  startFrom?: string;
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

const defaultScreenshotPath = (flow: string, stepId: string) =>
  `docs/${flow}/screenshots/${stepId}.png`;

/** Resolve a `target` value (`$name` ref or inline selector) using the flow-file's locators (or a custom resolver). */
export function resolveTarget(
  value: string,
  flow: FlowFile,
  resolver?: RunFlowOptions["resolveLocator"],
): string {
  const name = locatorRefName(value);
  if (!name) return value; // inline selector
  const resolved = (resolver ?? ((n: string) => flow.locators[n]))(name);
  if (resolved === undefined) {
    throw new Error(`unresolved locator $${name}`);
  }
  return resolved;
}

async function applyWait(
  driver: BrowserDriver,
  wait: WaitSpec,
  resolve: (v: string) => string,
): Promise<void> {
  if (typeof wait === "string") {
    if (wait === "network_idle") return driver.waitForNetworkIdle();
    if (wait === "load") return driver.waitForLoad();
    // element_stable without a selector is a no-op signal in this prototype; a real driver may track layout.
    return;
  }
  if ("selector" in wait) return driver.waitForSelector(resolve(wait.selector), wait.timeout_ms);
  if ("timeout_ms" in wait) return driver.waitForTimeout(wait.timeout_ms);
}

async function checkSuccess(
  driver: BrowserDriver,
  success: SuccessSpec,
  resolve: (v: string) => string,
  stepId: string,
): Promise<void> {
  const at = async () => `at ${await driver.currentUrl().catch(() => "?")}`;
  if ("visible" in success) {
    const sel = resolve(success.visible);
    if (!(await driver.isVisible(sel))) {
      throw new FlowExecutionError(
        `expected ${success.visible} to be visible — ${await at()}; ${await driver.count(sel).catch(() => "?")} element(s) match the selector`,
        stepId,
      );
    }
    return;
  }
  if ("hidden" in success) {
    const sel = resolve(success.hidden);
    if (await driver.isVisible(sel)) {
      throw new FlowExecutionError(
        `expected ${success.hidden} to be hidden but a match is visible — ${await at()}; ${await driver.count(sel).catch(() => "?")} element(s) match`,
        stepId,
      );
    }
    return;
  }
  if ("url_matches" in success) {
    if (!(await driver.urlMatches(success.url_matches))) {
      throw new FlowExecutionError(
        `expected URL to match /${success.url_matches}/ — actual: ${await driver.currentUrl().catch(() => "?")}`,
        stepId,
      );
    }
    return;
  }
  if ("text_contains" in success) {
    const { selector, text } = success.text_contains;
    const sel = resolve(selector);
    if (!(await driver.textContains(sel, text))) {
      const actual = ((await driver.textOf(sel).catch(() => null)) ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      throw new FlowExecutionError(
        `expected ${selector} to contain ${JSON.stringify(text)} — ${await at()}; actual text: ${JSON.stringify(actual)}`,
        stepId,
      );
    }
  }
}

async function executeAction(
  driver: BrowserDriver,
  step: Step,
  selector: string | null,
): Promise<void> {
  switch (step.action) {
    case "navigate":
      if (!step.value)
        throw new FlowExecutionError("navigate requires `value` (path/URL)", step.id);
      return driver.goto(step.value);
    case "click":
      return driver.click(needSelector(selector, step));
    case "fill":
      if (step.value === undefined) throw new FlowExecutionError("fill requires `value`", step.id);
      return driver.fill(needSelector(selector, step), step.value);
    case "upload":
      if (step.value === undefined)
        throw new FlowExecutionError("upload requires `value` (file path)", step.id);
      return driver.upload(needSelector(selector, step), step.value);
    case "press":
      if (!step.value) throw new FlowExecutionError("press requires `value` (key)", step.id);
      return driver.press(selector, step.value);
    case "hover":
      return driver.hover(needSelector(selector, step));
    case "select":
      if (step.value === undefined)
        throw new FlowExecutionError("select requires `value` (option)", step.id);
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
  if (selector === null)
    throw new FlowExecutionError(`action "${step.action}" requires a \`target\``, step.id);
  return selector;
}

/**
 * Execute a flow-file against a {@link BrowserDriver}, re-capturing screenshots and emitting annotation records.
 * Deterministic: given the same site state and driver behaviour, produces the same result. Halts on the first
 * locator / success-criterion failure.
 */
export async function runFlow(
  flow: FlowFile,
  driver: BrowserDriver,
  opts: RunFlowOptions = {},
): Promise<RunFlowResult> {
  const captureDocs = opts.captureDocs ?? true;
  const screenshotPathOf = opts.screenshotPath ?? defaultScreenshotPath;
  const resolve = (v: string) => resolveTarget(v, flow, opts.resolveLocator);

  const executed: ExecutedStep[] = [];
  const annotations: AnnotationRecord[] = [];

  // startFrom validation: if set, must name an actual step id in this (already-merged) flow.
  // Catching the typo here is cheaper than running, halting, and reading the wall of Playwright noise.
  if (opts.startFrom && !flow.steps.some((s) => s.id === opts.startFrom)) {
    throw new Error(`startFrom: no step with id "${opts.startFrom}" in flow "${flow.name}"`);
  }
  let skipping = !!opts.startFrom;

  // Flow-level redactions apply to every screenshot; per-step ones are additive. Resolved up
  // front (locator refs → selectors, default style applied) so halt shots get them too.
  const redactionsFor = (step: Step): ResolvedRedaction[] =>
    [...(flow.redactions ?? []), ...(step.redactions ?? [])].map((r) =>
      "selector" in r
        ? { selector: resolve(r.selector), style: r.style ?? "box" }
        : { region: r.region, style: r.style ?? "box" },
    );

  for (const step of flow.steps) {
    if (skipping) {
      if (step.id === opts.startFrom) skipping = false;
      else continue;
    }
    const selector = step.target ? resolve(step.target) : null;
    const redactions = redactionsFor(step);
    try {
      await executeAction(driver, step, selector);
      if (step.wait_for) {
        if (step.wait_for === "element_stable" && selector)
          await driver.waitForElementStable(selector);
        else await applyWait(driver, step.wait_for, resolve);
      }
      if (step.success) await checkSuccess(driver, step.success, resolve, step.id);
    } catch (e) {
      // Optional step (conditionally-present UI): swallow the failure, log it, move on.
      // No screenshot / annotation for a skipped step — same as a `--start-from`-skipped one.
      if (step.optional) {
        process.stderr.write(
          `runFlow: optional step "${step.id}" (${step.action}) skipped — ${(e as Error).message}\n`,
        );
        continue;
      }
      // Halt: dump a screenshot for triage (best-effort), prepend a 1-line inferred cause
      // (parsed from Playwright's actionability log so the agent doesn't have to scan ~20 lines
      //  to know why), then surface step id + url + halt-shot path uniformly.
      const haltShot = `docs/${flow.name}/halts/${step.id}.png`;
      // Halt shots can capture the same sensitive UI as step shots — same redactions apply.
      if (captureDocs) await driver.screenshot(haltShot, redactions).catch(() => undefined);
      const suffix = captureDocs ? ` (halt screenshot: ${haltShot})` : "";
      const cause = inferHaltCause((e as Error).message ?? "");
      const causePrefix = cause ? `[${cause}] ` : "";
      if (e instanceof FlowExecutionError) {
        throw new FlowExecutionError(`${causePrefix}${e.message}${suffix}`, e.stepId, e.cause);
      }
      const where = await driver.currentUrl().catch(() => "?");
      throw new FlowExecutionError(
        `${causePrefix}step "${step.id}" (${step.action}) failed at ${where}: ${(e as Error).message}${suffix}`,
        step.id,
        e,
      );
    }

    const ex: ExecutedStep = {
      id: step.id,
      action: step.action,
      ...(selector ? { selector } : {}),
    };
    // Doc capture is best-effort. When a step's action *transitions the UI* the action target is often
    // unmounted by the time we capture — `boundingBox` would hang for the driver's default 30s. Short
    // timeout + try/catch → continue with no annotation for this step. `annotation.target` (if set)
    // overrides the anchor — point the halo at a different element that *does* exist in the new state.
    // A step can also have `annotations: [...]` to put multiple numbered call-outs on the same screenshot —
    // each becomes one record with a 1-based `index`; an `annotation` (singular) emits one record without
    // `index` (un-numbered, back-compat).
    const anns = step.annotations ?? (step.annotation ? [step.annotation] : []);
    if (captureDocs && anns.length > 0) {
      try {
        const shot = screenshotPathOf(flow.name, step.id);
        await driver.screenshot(shot, redactions);
        ex.screenshot = shot;
        for (let i = 0; i < anns.length; i++) {
          const ann = anns[i]!;
          const annSelector = ann.target ? resolve(ann.target) : selector;
          const bbox = annSelector ? await driver.boundingBox(annSelector, 2000) : null;
          annotations.push({
            step: step.id,
            selector: annSelector ?? "",
            ...(bbox ? { bounding_box: bbox } : {}),
            copy: ann.copy,
            ...(ann.arrow ? { arrow_style: ann.arrow } : {}),
            ...(ann.nudge ? { nudge: ann.nudge } : {}),
            ...(anns.length > 1 ? { index: i + 1 } : {}),
          });
        }
      } catch (e) {
        process.stderr.write(
          `runFlow: step "${step.id}" — annotation capture skipped (${(e as Error).message})\n`,
        );
      }
    }
    executed.push(ex);
    if (opts.stopAfter && step.id === opts.stopAfter) break;
  }

  return {
    flow: flow.name,
    steps: executed,
    annotations: { schema: "site-docs/annotations@1", flow: flow.name, annotations },
  };
}
