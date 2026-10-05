// Static analysis of flow-files. Catches common authoring mistakes at write-time, before a run.
// Pure-static — no Playwright, no live page. Run via `docsxai lint`.

import type { FlowFile } from "./doc-pack.js";
import { locatorRefName, referencedLocatorNames } from "./flow-file.js";
import { hiddenAtEachStep } from "./flow-hidden.js";

export type LintSeverity = "error" | "warning" | "info";

export type LintIssue = {
  code: string;
  severity: LintSeverity;
  flow: string;
  stepId?: string;
  message: string;
  suggestion?: string;
};

/** An injectable lint rule — the open hinge for the plugins runtime. Runs after the built-ins. */
export type LintRule = {
  /** Stable diagnostic code (the built-ins use `RNNN`; injected rules should pick another prefix). */
  code: string;
  run: (flow: FlowFile, opts: LintOptions) => Promise<LintIssue[]> | LintIssue[];
};

export type LintOptions = {
  /** Resolver for `extends` (used by R001/R005). If omitted, inter-flow rules are skipped. */
  loadFlow?: (name: string) => Promise<FlowFile> | FlowFile;
  /** Additional rules run after the built-ins (same flow, same options). */
  extraRules?: LintRule[];
};

/** Heuristic — names that suggest a step kicks off a multi-minute backend op. */
const LONG_ASYNC = /generate|create|process|submit|upload|translate|render|publish|export/i;

/** A "bare" data-attribute selector like `[data-foo="x"]` with no further qualifier. */
const BARE_DATA_ATTR = /^\[data-[a-z][a-z0-9-]*="[^"]+"\]$/;

const DEEP_CHAIN_THRESHOLD = 4;

/** Actions that wait on their `target`, so an absent target costs the whole default timeout. */
const TARGET_WAIT_ACTIONS = new Set([
  "click",
  "fill",
  "upload",
  "press",
  "hover",
  "select",
  "check",
  "uncheck",
  "hide",
]);

/** Steps that stall the full default wait when their element is absent, and set no shorter one. */
function waitsFullDefault(step: FlowFile["steps"][number]): boolean {
  if (step.timeout_ms !== undefined) return false;
  if (TARGET_WAIT_ACTIONS.has(step.action)) return step.target !== undefined;
  const w = step.wait_for;
  return (
    step.action === "wait" && typeof w === "object" && "selector" in w && w.timeout_ms === undefined
  );
}

export async function lintFlow(flow: FlowFile, opts: LintOptions = {}): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];

  // R001 — extends chain depth; R005 — extends target missing
  if (opts.loadFlow && flow.extends) {
    const chain = await walkChain(flow, opts.loadFlow);
    if (chain.missing !== undefined) {
      issues.push({
        code: "R005",
        severity: "error",
        flow: flow.name,
        message: `\`extends: ${chain.missing}\` names a flow that doesn't exist in the workspace`,
        suggestion: "fix the name, or create flows/" + chain.missing + ".flow.yaml",
      });
    } else if (chain.depth >= DEEP_CHAIN_THRESHOLD) {
      issues.push({
        code: "R001",
        severity: "info",
        flow: flow.name,
        message: `extends chain depth is ${chain.depth}`,
        suggestion:
          "consider flattening — deep chains add per-run setup cost and obscure the step order",
      });
    }
  }

  // R006 — locator defined but never referenced
  const referenced = referencedLocatorNames(flow);
  for (const name of Object.keys(flow.locators)) {
    if (!referenced.has(name)) {
      issues.push({
        code: "R006",
        severity: "info",
        flow: flow.name,
        message: `locator \`${name}\` is defined but never referenced by any step, wait, success, annotation, or redaction`,
        suggestion:
          "remove it — unless a child flow references it via `extends` (references in children count only in the child)",
      });
    }
  }

  // R007 — terminal step lacks `success` (with `extends`, this flow's steps run last, so its
  // final step IS the merged flow's terminal step)
  const lastStep = flow.steps[flow.steps.length - 1];
  if (lastStep && !lastStep.success) {
    issues.push({
      code: "R007",
      severity: "warning",
      flow: flow.name,
      stepId: lastStep.id,
      message:
        "the flow's terminal step has no `success` criterion — the run can end without verifying the end state",
      suggestion:
        "add `success: { visible: $… }` (or url_matches / text_contains) to the last step",
    });
  }

  // Resolve a `$ref` to its selector for same-element comparison; an un-resolvable ref (e.g.
  // inherited from an `extends` parent) compares by its raw `$name`, which still matches itself.
  const resolveMaybe = (v: string): string => {
    const name = locatorRefName(v);
    return name ? (flow.locators[name] ?? v) : v;
  };
  const flowRedactionSelectors = new Set(
    (flow.redactions ?? []).flatMap((r) => ("selector" in r ? [resolveMaybe(r.selector)] : [])),
  );

  const hiddenAt = hiddenAtEachStep(flow, resolveMaybe);

  for (const [index, step] of flow.steps.entries()) {
    const anns = step.annotation ? [step.annotation] : (step.annotations ?? []);

    // R002 — annotation anchored to a likely-unmounting action target
    if (anns.length && (step.action === "click" || step.action === "navigate") && step.target) {
      const anyWithoutOverride = anns.some((a) => !a.target);
      if (anyWithoutOverride) {
        issues.push({
          code: "R002",
          severity: "warning",
          flow: flow.name,
          stepId: step.id,
          message: `annotation has no \`target\` override on a \`${step.action}\` action; if the action unmounts its target, the halo will have nothing to anchor to`,
          suggestion:
            "set `annotation.target` (or `annotations[].target`) to an element that exists in the resulting state",
        });
      }
    }

    // R003 — wait_for object form without timeout_ms on a long-async-looking step
    const w = step.wait_for;
    if (w && typeof w === "object" && !Array.isArray(w) && "selector" in w && !w.timeout_ms) {
      const targetText = step.target ? (locatorRefName(step.target) ?? step.target) : "";
      if (LONG_ASYNC.test(step.id) || LONG_ASYNC.test(targetText)) {
        issues.push({
          code: "R003",
          severity: "warning",
          flow: flow.name,
          stepId: step.id,
          message: `wait_for has no timeout_ms but the step looks long-async (keyword match)`,
          suggestion: "add `timeout_ms: 180000` (or higher for multi-minute backend ops)",
        });
      }
    }

    // R004 — bare `[data-*=…]` selector — may have hidden duplicates
    if (step.target) {
      const sel = step.target.startsWith("$")
        ? flow.locators[locatorRefName(step.target) ?? ""]
        : step.target;
      if (sel && BARE_DATA_ATTR.test(sel)) {
        issues.push({
          code: "R004",
          severity: "info",
          flow: flow.name,
          stepId: step.id,
          message: `selector \`${sel}\` is a bare \`[data-*=…]\` match — may resolve to multiple DOM nodes (visible + hidden duplicate)`,
          suggestion:
            "if duplicates exist, scope with `:visible` or add a `:has-text(...)` qualifier",
        });
      }
    }

    // R008 — un-guarded optional step
    if (step.optional && !step.wait_for && !step.success) {
      issues.push({
        code: "R008",
        severity: "warning",
        flow: flow.name,
        stepId: step.id,
        message:
          "`optional: true` with no `wait_for` or `success` — every failure is silently swallowed, so a real regression on this step would be masked",
        suggestion:
          "add a `wait_for: { selector: … }` or a `success:` check to make the presence test explicit",
      });
    }

    // R011 — optional step with no short timeout: a miss costs the full default wait
    if (step.optional && waitsFullDefault(step)) {
      issues.push({
        code: "R011",
        severity: "info",
        flow: flow.name,
        stepId: step.id,
        message:
          "`optional: true` step has no `timeout_ms` — when its element is absent the run waits Playwright's full 30 s default before skipping it",
        suggestion:
          step.action === "wait"
            ? "add `timeout_ms: 1500` to the step (or to its `wait_for`) so a miss is skipped fast"
            : "add `timeout_ms: 1500` (100–30000) so a miss is skipped fast; keep the default only if the element can legitimately take longer to appear",
      });
    }

    // R012 — `hide` with no target (the runtime would halt on it)
    if (step.action === "hide" && !step.target) {
      issues.push({
        code: "R012",
        severity: "error",
        flow: flow.name,
        stepId: step.id,
        message:
          "`hide` has no `target` — there is nothing to hide, and the run halts on this step",
        suggestion: "set `target` to the element (a `$ref` or an inline selector) to hide",
      });
    }

    // R013 — step reaches an element an earlier `hide` step hid: a hidden element isn't visible,
    // so a click waits out its timeout, an annotation has nothing to anchor to, a visible-wait never ends
    const reached: Array<[string, string, ReadonlySet<string>]> = [];
    if (step.target && !["hide", "show", "navigate"].includes(step.action))
      reached.push([step.target, `\`${step.action}\` target`, hiddenAt[index]!.before]);
    for (const ann of anns) {
      const anchor = ann.target ?? step.target;
      if (anchor) reached.push([anchor, "annotation anchor", hiddenAt[index]!.after]);
    }
    if (step.wait_for && typeof step.wait_for === "object" && "selector" in step.wait_for)
      reached.push([step.wait_for.selector, "`wait_for` selector", hiddenAt[index]!.after]);
    if (step.success && "visible" in step.success)
      reached.push([step.success.visible, "`success.visible` selector", hiddenAt[index]!.after]);
    for (const [ref, role, hidden] of reached) {
      if (!hidden.has(resolveMaybe(ref))) continue;
      issues.push({
        code: "R013",
        severity: "warning",
        flow: flow.name,
        stepId: step.id,
        message: `${role} \`${ref}\` is hidden by an earlier \`hide\` step, so it can never be visible here`,
        suggestion:
          "add a `show` step (with this target, or none to show everything) before this step, or move the `hide` after it",
      });
    }

    // R009 — element_stable with no selector context (a no-op)
    if (step.wait_for === "element_stable" && !step.target) {
      issues.push({
        code: "R009",
        severity: "warning",
        flow: flow.name,
        stepId: step.id,
        message:
          "`wait_for: element_stable` has no selector context (the step has no `target`) — it waits on nothing",
        suggestion:
          "give the step a `target`, or wait on a concrete element with `wait_for: { selector: $x }`",
      });
    }

    // R010 — annotation anchored to a redacted element (the call-out would point at a black box)
    const stepRedactionSelectors = new Set([
      ...flowRedactionSelectors,
      ...(step.redactions ?? []).flatMap((r) =>
        "selector" in r ? [resolveMaybe(r.selector)] : [],
      ),
    ]);
    if (stepRedactionSelectors.size) {
      for (const ann of anns) {
        const anchor = ann.target ?? step.target;
        if (anchor && stepRedactionSelectors.has(resolveMaybe(anchor))) {
          issues.push({
            code: "R010",
            severity: "warning",
            flow: flow.name,
            stepId: step.id,
            message: `annotation is anchored to \`${anchor}\`, which a redaction on this step masks — the call-out would point at a black box`,
            suggestion: "anchor the annotation to a different element, or drop the redaction",
          });
        }
      }
    }
  }

  for (const rule of opts.extraRules ?? []) {
    issues.push(...(await rule.run(flow, opts)));
  }

  return issues;
}

async function walkChain(
  flow: FlowFile,
  load: (name: string) => Promise<FlowFile> | FlowFile,
): Promise<{ depth: number; missing?: string }> {
  let depth = 1;
  let cur: FlowFile = flow;
  const seen = new Set<string>([flow.name]);
  while (cur.extends) {
    if (seen.has(cur.extends)) return { depth };
    seen.add(cur.extends);
    try {
      cur = await load(cur.extends);
    } catch {
      return { depth, missing: cur.extends };
    }
    depth++;
  }
  return { depth };
}

export function formatIssuesText(issues: LintIssue[]): string {
  if (issues.length === 0) return "✓ no issues\n";
  const byFlow = new Map<string, LintIssue[]>();
  for (const i of issues) {
    const list = byFlow.get(i.flow) ?? [];
    list.push(i);
    byFlow.set(i.flow, list);
  }
  let out = "";
  for (const [flow, list] of byFlow) {
    out += `flow ${flow}\n`;
    for (const i of list) {
      const where = i.stepId ? `step '${i.stepId}': ` : "";
      out += `  ${i.code} [${i.severity}] ${where}${i.message}\n`;
      if (i.suggestion) out += `    → ${i.suggestion}\n`;
    }
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  out += `\n${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}, ${infos} info\n`;
  return out;
}
