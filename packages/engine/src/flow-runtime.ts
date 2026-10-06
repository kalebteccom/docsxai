// Flow-file runtime — the deterministic execution side.
//
// `docsxai run` translates a parsed flow-file into a sequence of browser actions, executes
// them headlessly with zero LLM involvement, re-captures screenshots, and re-emits the doc-pack
// artifacts (annotations, etc.). One canonical locator per step; execution halts on locator or
// success-criterion failure — drift is a signal to recalibrate, not to absorb (no fallbacks).
//
// The runtime is written against a thin {@link BrowserDriver} abstraction so it's testable
// without a real browser; the Playwright-backed driver lives in a separate module.

import {
  type AnnotationPlacement,
  type AnnotationRecord,
  type AnnotationsFile,
  type BoundingBox,
  type FlowFile,
  type RedactionRegion,
  type RedactionStyle,
  type Step,
  type VariantInfo,
} from "./doc-pack.js";
import { locatorRefName } from "./flow-file.js";
import { FlowExecutionError, inferHaltCause } from "./flow-halt.js";
import { pickCopy, variantDocDir } from "./flow-matrix.js";
import { checkSuccess } from "./flow-success.js";
import { applyWait } from "./flow-wait.js";
import { OBSTACLE_RADIUS, selectObstacles, type NearbyBoxes } from "./obstacles.js";

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
  { selector: string; style: RedactionStyle } | { region: RedactionRegion; style: RedactionStyle };

/** What the runtime needs from a browser. Selectors passed here are already resolved (no `$ref`). */
export interface BrowserDriver {
  goto(url: string): Promise<void>;
  /**
   * The seven target actions take an optional `timeoutMs`: how long to wait for the target to become
   * actionable before throwing. Undefined keeps the driver default, so a step without `timeout_ms`
   * behaves exactly as before.
   */
  click(selector: string, timeoutMs?: number): Promise<void>;
  fill(selector: string, value: string, timeoutMs?: number): Promise<void>;
  upload(selector: string, filePath: string, timeoutMs?: number): Promise<void>;
  press(selector: string | null, key: string, timeoutMs?: number): Promise<void>;
  hover(selector: string, timeoutMs?: number): Promise<void>;
  selectOption(selector: string, value: string, timeoutMs?: number): Promise<void>;
  setChecked(selector: string, checked: boolean, timeoutMs?: number): Promise<void>;

  /**
   * Hide every element `selector` matches: `visibility: hidden`, so the element keeps its box and
   * nothing reflows, and it stays out of every later screenshot (halt shots too). Waits up to
   * `timeoutMs` for a match to exist, throws if none does. The hiding is by selector and holds for
   * the rest of the session, across navigations and re-renders, until {@link showElements}.
   * Implementations apply a fixed engine-owned rule; the selector is data, never CSS or script.
   *
   * Optional, like {@link waitForSettled}: a driver written before `hide` existed still satisfies the
   * interface. The runtime halts a `hide` step on a driver without it, with a message naming the method.
   */
  hideElements?(selector: string, timeoutMs?: number): Promise<void>;
  /**
   * Undo {@link hideElements} for the selector as it was given there, or for everything when `null`. Instant; matching nothing is fine.
   * Optional; the runtime halts a `show` step on a driver without it, with a message naming the method.
   */
  showElements?(selector: string | null): Promise<void>;

  waitForNetworkIdle(): Promise<void>;
  waitForLoad(): Promise<void>;
  waitForElementStable(selector: string): Promise<void>;
  /**
   * Wait until the page has settled: web fonts loaded, the images inside the viewport finished
   * loading, and the layout of the viewport-visible elements unchanged across consecutive frames.
   * Bounded by `timeoutMs` (default 10 s); rejects with a message starting `settled: page did not
   * settle` and naming what was still moving when the budget ran out. Selector-free: an
   * implementation runs a fixed engine-owned check, and no flow value reaches the page.
   *
   * Optional so a driver written before `settled` existed still satisfies the interface. The
   * runtime halts a `wait_for: settled` step on a driver without it, with a message that says so.
   */
  waitForSettled?(timeoutMs?: number): Promise<void>;
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
  /**
   * Boxes of the visible text and interactive elements within `radius` CSS px of `selector`, in
   * the screenshot's pixel space (scaled by the device scale factor, like {@link boundingBox}).
   * The target's own subtree and interactive elements containing it are left out. Order is the
   * driver's; `selectObstacles` sorts, clips and caps. Returns `null` when the target isn't visible
   * within `timeoutMs`; rejects if the scan itself runs past `timeoutMs`. The scan happens after the
   * screenshot, so a continuously animating page can drift from the image. Only called when a workspace turns on `annotations.obstacles`.
   *
   * Optional. With `annotations.obstacles` on, the runtime halts an annotated step on a driver
   * without it, with a message naming the method; with it off, the method is never called.
   */
  nearbyBoxes?(selector: string, radius: number, timeoutMs?: number): Promise<NearbyBoxes | null>;
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

export { FlowExecutionError, inferHaltCause } from "./flow-halt.js";

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

export interface RunFlowOptions {
  /** Resolve a locator name → selector. Defaults to the flow-file's own `locators` map. */
  resolveLocator?: (name: string) => string | undefined;
  /** Where screenshots are written, relative to the doc pack root. Default: `docs/<flow>/screenshots/<step>.png`, or `docs/<flow>/<variant>/screenshots/<step>.png` with `variant`. */
  screenshotPath?: (flow: string, stepId: string) => string;
  /**
   * The matrix variant `flow` was expanded for (from `expandFlow`). Moves the default screenshot and
   * halt-shot paths under `docs/<flow>/<variant>/`, names the variant in a halt message, and is recorded
   * as `variant` in the returned annotations. Absent for a flow without a `matrix`: output is unchanged.
   */
  variant?: VariantInfo;
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
  /**
   * Record the visible text and controls around each annotation's target as `obstacles` on its
   * record (screenshot pixels, target excluded) so the burner keeps callouts off them. Default
   * false: records are then exactly what they were before the field existed.
   */
  obstacles?: boolean;
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

const defaultScreenshotPath = (flow: string, stepId: string, variant?: string) =>
  `${variantDocDir(flow, variant)}/screenshots/${stepId}.png`;

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

/** Obstacles around `selector`, best-effort like the halo box: a failed scan leaves the field off. */
async function obstaclesAround(
  driver: BrowserDriver,
  selector: string,
  target: BoundingBox,
  stepId: string,
  placement?: AnnotationPlacement,
): Promise<BoundingBox[]> {
  if (!driver.nearbyBoxes) return [];
  const radius = placement?.obstacle_radius ?? OBSTACLE_RADIUS;
  try {
    const scan = await driver.nearbyBoxes(selector, radius, 2000);
    return scan
      ? selectObstacles(scan, target, {
          radius,
          ...(placement?.obstacle_limit !== undefined ? { limit: placement.obstacle_limit } : {}),
        })
      : [];
  } catch (e) {
    process.stderr.write(
      `runFlow: step "${stepId}" — obstacle scan skipped (${(e as Error).message})\n`,
    );
    return [];
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
      return driver.click(needSelector(selector, step), step.timeout_ms);
    case "fill":
      if (step.value === undefined) throw new FlowExecutionError("fill requires `value`", step.id);
      return driver.fill(needSelector(selector, step), step.value, step.timeout_ms);
    case "upload":
      if (step.value === undefined)
        throw new FlowExecutionError("upload requires `value` (file path)", step.id);
      return driver.upload(needSelector(selector, step), step.value, step.timeout_ms);
    case "press":
      if (!step.value) throw new FlowExecutionError("press requires `value` (key)", step.id);
      return driver.press(selector, step.value, step.timeout_ms);
    case "hover":
      return driver.hover(needSelector(selector, step), step.timeout_ms);
    case "select":
      if (step.value === undefined)
        throw new FlowExecutionError("select requires `value` (option)", step.id);
      return driver.selectOption(needSelector(selector, step), step.value, step.timeout_ms);
    case "check":
      return driver.setChecked(needSelector(selector, step), true, step.timeout_ms);
    case "uncheck":
      return driver.setChecked(needSelector(selector, step), false, step.timeout_ms);
    case "wait":
      return; // a bare `wait` step just runs its `wait_for`
    case "hide":
      if (!driver.hideElements) throw new Error(missingMethod("hide", "hideElements"));
      return driver.hideElements(needSelector(selector, step), step.timeout_ms);
    case "show":
      if (!driver.showElements) throw new Error(missingMethod("show", "showElements"));
      return driver.showElements(selector); // no target = show everything hidden so far
  }
}

/** The halt message for a step whose optional driver method is missing. `halt-cause` keys on its shape. */
function missingMethod(feature: string, method: string): string {
  return `${feature}: driver has no ${method} (this browser driver doesn't implement it)`;
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
  if (flow.matrix) {
    throw new Error(
      `runFlow: flow "${flow.name}" has a \`matrix\`; expand it (expandFlow) and run each variant`,
    );
  }
  const captureDocs = opts.captureDocs ?? true;
  const variantId = opts.variant?.id;
  const screenshotPathOf =
    opts.screenshotPath ??
    ((name: string, stepId: string) => defaultScreenshotPath(name, stepId, variantId));
  const locale = flow.environment?.locale;
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
        else
          await applyWait(
            driver,
            step.wait_for,
            resolve,
            step.action === "wait" || step.wait_for === "settled" ? step.timeout_ms : undefined,
          );
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
      const haltShot = `${variantDocDir(flow.name, variantId)}/halts/${step.id}.png`;
      // Halt shots can capture the same sensitive UI as step shots — same redactions apply.
      if (captureDocs) await driver.screenshot(haltShot, redactions).catch(() => undefined);
      const suffix = captureDocs ? ` (halt screenshot: ${haltShot})` : "";
      const cause = inferHaltCause((e as Error).message ?? "");
      const causePrefix = cause ? `[${cause}] ` : "";
      const variantTag = variantId ? `[variant ${variantId}] ` : "";
      if (e instanceof FlowExecutionError) {
        throw new FlowExecutionError(
          `${causePrefix}${variantTag}${e.message}${suffix}`,
          e.stepId,
          e.cause,
          variantId,
        );
      }
      const where = await driver.currentUrl().catch(() => "?");
      throw new FlowExecutionError(
        `${causePrefix}${variantTag}step "${step.id}" (${step.action}) failed at ${where}: ${(e as Error).message}${suffix}`,
        step.id,
        e,
        variantId,
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
    if (captureDocs && anns.length > 0 && opts.obstacles && !driver.nearbyBoxes) {
      // Obstacle scanning was asked for and cannot run: halt rather than write annotations without it.
      throw new FlowExecutionError(
        missingMethod("obstacles", "nearbyBoxes") +
          "; turn off `annotations.obstacles` in .docsxai.json or use a driver that has it",
        step.id,
        undefined,
        variantId,
      );
    }
    if (captureDocs && anns.length > 0) {
      try {
        const shot = screenshotPathOf(flow.name, step.id);
        await driver.screenshot(shot, redactions);
        ex.screenshot = shot;
        for (let i = 0; i < anns.length; i++) {
          const ann = anns[i]!;
          const annSelector = ann.target ? resolve(ann.target) : selector;
          const bbox = annSelector ? await driver.boundingBox(annSelector, 2000) : null;
          const obstacles =
            opts.obstacles && annSelector && bbox
              ? await obstaclesAround(driver, annSelector, bbox, step.id, ann.placement)
              : [];
          annotations.push({
            step: step.id,
            selector: annSelector ?? "",
            ...(bbox ? { bounding_box: bbox } : {}),
            ...(obstacles.length > 0 ? { obstacles } : {}),
            copy: pickCopy(ann, locale),
            ...(ann.arrow ? { arrow_style: ann.arrow } : {}),
            ...(ann.nudge ? { nudge: ann.nudge } : {}),
            ...(ann.placement ? { placement: ann.placement } : {}),
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
    annotations: {
      schema: "docsxai/annotations@1",
      flow: flow.name,
      ...(opts.variant ? { variant: opts.variant } : {}),
      annotations,
    },
  };
}
