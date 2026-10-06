// Halt diagnosis — gather the context a calibration agent needs to propose a recalibration diff.
// Pure data + recommendations; the engine never patches the flow-file itself (that's an explicit
// opt-in action by the agent / human, never ambient). The agent reads the report, walks the live
// page (typically via browxai), picks a fix, and edits the flow-file. `docsxai run --start-from
// <step-id> --cdp <endpoint>` then validates the edit in seconds.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { BoundingBox, FlowFile, Step } from "./doc-pack.js";
import { hiddenAtEachStep } from "./flow-hidden.js";
import { locatorRefName } from "./flow-file.js";
import { variantDocDir, type FlowVariant } from "./flow-matrix.js";
import { resolveWorkspacePath } from "./workspace.js";
import type { ActionableState, BrowserDriver } from "./flow-runtime.js";

export type DiagnoseRecommendationKind =
  | "selector" // change the step's `target` selector
  | "wait_for" // add or strengthen `wait_for`
  | "success" // re-examine the `success` criterion
  | "annotation_target" // set `annotation.target` to a surviving element
  | "split_step" // insert a step (scroll, dismiss overlay, etc.)
  | "investigate"; // ambiguous — needs human/agent decision before recommending an edit

export interface DiagnoseRecommendation {
  kind: DiagnoseRecommendationKind;
  rationale: string;
  suggestion: string;
}

export interface DiagnoseLiveProbe {
  cdpEndpoint: string;
  url: string;
  actionable: ActionableState;
  bbox: BoundingBox | null;
}

export interface DiagnoseReport {
  workspace: string;
  flow: string;
  /** The matrix variant diagnosed. Absent for a flow without a `matrix`. */
  variant?: string;
  /** Every variant id the flow's `matrix` expands to (present with `variant`). */
  variants?: string[];
  step: {
    id: string;
    action: Step["action"];
    target?: string;
    resolvedSelector?: string;
    wait_for?: unknown;
    success?: unknown;
  };
  halt: {
    screenshotRelPath?: string;
    screenshotAbsPath?: string;
  };
  live?: DiagnoseLiveProbe;
  recommendations: DiagnoseRecommendation[];
}

/** Map an `ActionableState` to concrete recommendations for the agent. */
export function recommendFromActionable(state: ActionableState): DiagnoseRecommendation[] {
  switch (state) {
    case "actionable":
      return [
        {
          kind: "investigate",
          rationale: "The current target is actionable on the live page right now.",
          suggestion:
            "Drift may be intermittent (race condition) or in the `success` criterion. Consider adding `wait_for: network_idle`, `settled` (fonts, images and layout) or `element_stable`; re-check the `success` clause against the live target state.",
        },
      ];
    case "not-found":
      return [
        {
          kind: "selector",
          rationale:
            "Selector matches 0 elements on the live page — the element was renamed, moved, or removed.",
          suggestion:
            "Re-discover the element via the calibration loop (browxai's `find()`, or `docsxai inspect`). Pick a new canonical locator and commit it as the step's `target` (or update the named entry in the flow's `locators:` block). If the element is only sometimes there, declare that instead: `optional: true` with a short `timeout_ms` (e.g. 1500) skips a miss in seconds, not after the full 30 s default.",
        },
      ];
    case "multiple-matches":
      return [
        {
          kind: "selector",
          rationale:
            "Selector matches multiple DOM nodes — strict-mode violation territory; one of them is likely a hidden duplicate.",
          suggestion:
            "Scope the selector: append `:visible`, use `:nth-match(<sel>, 1)`, or add a stable qualifier (parent class, `:has-text(...)`). Avoid silently picking one — the duplicate signal usually means the locator isn't specific enough.",
        },
      ];
    case "disabled":
      return [
        {
          kind: "investigate",
          rationale: "Selector resolves to a single visible element that is `disabled`.",
          suggestion:
            "Check whether the action is appropriate for the target state — sometimes a UI element is intentionally disabled (clip-driven inputs, gated controls). The doc may need to describe the disabled-state behaviour rather than trying to act on the element. If unexpected, the disabled state itself is a product-side question.",
        },
      ];
    case "detached":
      return [
        {
          kind: "annotation_target",
          rationale:
            "Selector resolved but the element isn't attached to the DOM any more — usually unmounted by the action itself (the step's action transitions the UI, and the original target is gone in the post-action state).",
          suggestion:
            "Set the annotation's `target` to a different element that survives the transition (an element in the resulting state). The action's `target` stays the same; only the annotation anchor moves.",
        },
      ];
    case "not-visible":
      return [
        {
          kind: "wait_for",
          rationale:
            "Selector resolves to a single element but it's hidden (`display: none` / `visibility: hidden` / zero-size).",
          suggestion:
            "Add (or strengthen) `wait_for: { selector: <sel>, timeout_ms: <ms> }` to give the element time to become visible. If it's permanently hidden, the locator probably moved — re-discover.",
        },
      ];
    case "off-screen":
      return [
        {
          kind: "split_step",
          rationale:
            "Selector resolves to a CSS-visible element but it's outside the viewport, and Playwright's auto-scroll didn't reach it.",
          suggestion:
            "Insert a scroll-into-view step before the action (or pick a parent element that's in the viewport). Off-screen elements inside `overflow: auto` containers are usually fine — this state means the page scroll is the issue, not a scroller.",
        },
      ];
    case "covered":
      return [
        {
          kind: "split_step",
          rationale:
            "Another element receives clicks at this element's center — likely a modal, overlay, or tooltip covering the target.",
          suggestion:
            "Insert a step to dismiss the covering element (close button, click outside, ESC key), then act on the original target.",
        },
      ];
  }
}

/** Static recommendations from the flow-file shape alone (no live probe). */
export function recommendStatic(
  step: Step,
  halt: { screenshotRelPath?: string },
): DiagnoseRecommendation[] {
  const recs: DiagnoseRecommendation[] = [];
  if (halt.screenshotRelPath) {
    recs.push({
      kind: "investigate",
      rationale: `A halt screenshot exists at \`${halt.screenshotRelPath}\` — read it first; on most halts the visual state shows the issue immediately.`,
      suggestion: "Open the screenshot; compare the visual state to what the step expects.",
    });
  }
  if (step.action === "hide") {
    recs.push({
      kind: "selector",
      rationale:
        "A `hide` step waits for its target to exist (not to be visible); it halts when no element matched within the step's budget.",
      suggestion:
        "Check the locator against the live page. If the element is conditionally present (a dev-only overlay, a banner), set `optional: true` with a short `timeout_ms` (e.g. 1500) so a miss is skipped quickly.",
    });
  }
  const success = step.success as unknown;
  if (success && typeof success === "object" && success !== null && "text_contains" in success) {
    recs.push({
      kind: "success",
      rationale:
        "Success criterion uses `text_contains` — fragile against UI copy changes / localisation drift.",
      suggestion:
        "Verify the expected text still appears in the post-action state. If the text changed, update it; if the text shifted to a different element, change the success selector. Where stable, a structural criterion (visible/hidden element, url_matches) is more drift-resistant.",
    });
  }
  return recs;
}

/** The step reaches an element an earlier `hide` step hid: a hidden element is never visible, so waits on it run out. */
export function recommendHiddenTarget(flow: FlowFile, step: Step): DiagnoseRecommendation[] {
  const index = flow.steps.findIndex((s) => s.id === step.id);
  if (index < 0 || !step.target || step.action === "hide" || step.action === "show") return [];
  const resolve = (v: string): string => {
    const name = locatorRefName(v);
    return name ? (flow.locators[name] ?? v) : v;
  };
  if (!hiddenAtEachStep(flow, resolve)[index]!.before.has(resolve(step.target))) return [];
  return [
    {
      kind: "split_step",
      rationale:
        "An earlier `hide` step hides this step's target (`visibility: hidden`), so it is never visible or actionable here.",
      suggestion:
        "Insert a `show` step with this target (or none, to show everything) before this step, or move the `hide` step after it.",
    },
  ];
}

/** Pick the matrix variant to diagnose: the requested one, else the only one with a halt shot for the step. */
export async function pickDiagnoseVariant(opts: {
  workspace: string;
  flow: string;
  stepId: string;
  variants: FlowVariant[];
  requested: string | undefined;
}): Promise<{ variant: FlowVariant; ids: string[] } | { error: string }> {
  const ids = opts.variants.flatMap((v) => (v.id ? [v.id] : []));
  if (ids.length === 0) {
    return opts.requested
      ? { error: `--variant "${opts.requested}": flow "${opts.flow}" has no matrix` }
      : { variant: opts.variants[0]!, ids };
  }
  if (opts.requested) {
    const hit = opts.variants.find((v) => v.id === opts.requested);
    return hit
      ? { variant: hit, ids }
      : {
          error: `no variant "${opts.requested}" in flow "${opts.flow}" (variants: ${ids.join(", ")})`,
        };
  }
  const halted: FlowVariant[] = [];
  for (const v of opts.variants) {
    const shot = resolveWorkspacePath(
      opts.workspace,
      variantDocDir(opts.flow, v.id),
      "halts",
      `${opts.stepId}.png`,
    );
    if (
      await fs.access(shot).then(
        () => true,
        () => false,
      )
    )
      halted.push(v);
  }
  if (halted.length === 1) return { variant: halted[0]!, ids };
  return {
    error:
      `flow "${opts.flow}" has a matrix: pass --variant <id> (variants: ${ids.join(", ")}; ` +
      (halted.length > 0
        ? `halt screenshots for step "${opts.stepId}" in: ${halted.map((v) => v.id).join(", ")})`
        : `no halt screenshot found for step "${opts.stepId}")`),
  };
}

/** Build the full report. `liveProbe` is invoked lazily (only if a driver is supplied). */
export async function buildDiagnoseReport(opts: {
  workspace: string;
  flow: FlowFile;
  step: Step;
  resolvedSelector?: string;
  haltScreenshotAbsPath?: string;
  liveProbe?: () => Promise<DiagnoseLiveProbe>;
  /** The matrix variant `flow` was expanded for, and every variant of the matrix. */
  variant?: { id: string; all: string[] };
}): Promise<DiagnoseReport> {
  const haltExists = opts.haltScreenshotAbsPath
    ? await fs
        .access(opts.haltScreenshotAbsPath)
        .then(() => true)
        .catch(() => false)
    : false;
  const haltRel = haltExists
    ? path.relative(opts.workspace, opts.haltScreenshotAbsPath!)
    : undefined;
  const live = opts.liveProbe ? await opts.liveProbe() : undefined;

  const recommendations: DiagnoseRecommendation[] = [
    ...recommendStatic(opts.step, { screenshotRelPath: haltRel }),
    ...recommendHiddenTarget(opts.flow, opts.step),
    ...(live ? recommendFromActionable(live.actionable) : []),
  ];

  return {
    workspace: opts.workspace,
    flow: opts.flow.name,
    ...(opts.variant ? { variant: opts.variant.id, variants: opts.variant.all } : {}),
    step: {
      id: opts.step.id,
      action: opts.step.action,
      ...(opts.step.target ? { target: opts.step.target } : {}),
      ...(opts.resolvedSelector ? { resolvedSelector: opts.resolvedSelector } : {}),
      ...(opts.step.wait_for !== undefined ? { wait_for: opts.step.wait_for } : {}),
      ...(opts.step.success !== undefined ? { success: opts.step.success } : {}),
    },
    halt: {
      ...(haltRel ? { screenshotRelPath: haltRel } : {}),
      ...(haltExists ? { screenshotAbsPath: opts.haltScreenshotAbsPath } : {}),
    },
    ...(live ? { live } : {}),
    recommendations,
  };
}

/** Live-probe helper that uses any driver implementing the runtime's `BrowserDriver` interface. */
export async function probeLive(
  driver: BrowserDriver,
  selector: string,
  cdpEndpoint: string,
): Promise<DiagnoseLiveProbe> {
  const url = await driver.currentUrl();
  const actionable = await driver.actionable(selector);
  const bbox = await driver.boundingBox(selector, 500).catch(() => null);
  return { cdpEndpoint, url, actionable, bbox };
}

export function formatReportText(r: DiagnoseReport): string {
  let out = `diagnose: flow=${r.flow}${r.variant ? ` variant=${r.variant}` : ""} step=${r.step.id}\n`;
  if (r.variants) out += `variants: ${r.variants.join(", ")}\n`;
  out += "\n";
  out += `Current step:\n`;
  out += `  action: ${r.step.action}\n`;
  if (r.step.target)
    out += `  target: ${r.step.target}${r.step.resolvedSelector && r.step.resolvedSelector !== r.step.target ? ` (resolved: ${r.step.resolvedSelector})` : ""}\n`;
  if (r.step.wait_for !== undefined) out += `  wait_for: ${JSON.stringify(r.step.wait_for)}\n`;
  if (r.step.success !== undefined) out += `  success: ${JSON.stringify(r.step.success)}\n`;
  out += `\n`;
  if (r.halt.screenshotRelPath) {
    out += `Halt artifacts:\n  screenshot: ${r.halt.screenshotRelPath}\n\n`;
  } else {
    out += `Halt artifacts:\n  (no halt screenshot found at the expected path — run hasn't halted on this step recently, or screenshots are disabled)\n\n`;
  }
  if (r.live) {
    out += `Live probe (via ${r.live.cdpEndpoint}):\n`;
    out += `  url: ${r.live.url}\n`;
    out += `  actionable: ${r.live.actionable}\n`;
    out += `  bbox: ${r.live.bbox ? JSON.stringify(r.live.bbox) : "null"}\n\n`;
  }
  out += `Recommendations (${r.recommendations.length}):\n`;
  for (const rec of r.recommendations) {
    out += `  [${rec.kind}] ${rec.rationale}\n`;
    out += `    → ${rec.suggestion}\n`;
  }
  return out;
}
