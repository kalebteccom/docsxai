// Static analysis of flow-files. Catches common authoring mistakes at write-time, before a run.
// Pure-static — no Playwright, no live page. Run via `site-docs lint`.

import type { FlowFile } from "./doc-pack.js";
import { locatorRefName } from "./flow-file.js";

export type LintSeverity = "error" | "warning" | "info";

export type LintIssue = {
  code: string;
  severity: LintSeverity;
  flow: string;
  stepId?: string;
  message: string;
  suggestion?: string;
};

export type LintOptions = {
  /** Resolver for `extends` (used by R001). If omitted, inter-flow rules are skipped. */
  loadFlow?: (name: string) => Promise<FlowFile>;
};

/** Heuristic — names that suggest a step kicks off a multi-minute backend op. */
const LONG_ASYNC = /generate|create|process|submit|upload|translate|render|publish|export/i;

/** A "bare" data-attribute selector like `[data-foo="x"]` with no further qualifier. */
const BARE_DATA_ATTR = /^\[data-[a-z][a-z0-9-]*="[^"]+"\]$/;

const DEEP_CHAIN_THRESHOLD = 4;

export async function lintFlow(flow: FlowFile, opts: LintOptions = {}): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];

  // R001 — extends chain depth
  if (opts.loadFlow && flow.extends) {
    const depth = await chainDepth(flow, opts.loadFlow);
    if (depth >= DEEP_CHAIN_THRESHOLD) {
      issues.push({
        code: "R001",
        severity: "info",
        flow: flow.name,
        message: `extends chain depth is ${depth}`,
        suggestion: "consider flattening — deep chains add per-run setup cost and obscure the step order",
      });
    }
  }

  for (const step of flow.steps) {
    const anns = step.annotation ? [step.annotation] : step.annotations ?? [];

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
          suggestion: "set `annotation.target` (or `annotations[].target`) to an element that exists in the resulting state",
        });
      }
    }

    // R003 — wait_for object form without timeout_ms on a long-async-looking step
    const w = step.wait_for;
    if (w && typeof w === "object" && !Array.isArray(w) && "selector" in w && !w.timeout_ms) {
      const targetText = step.target ? locatorRefName(step.target) ?? step.target : "";
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
          suggestion: "if duplicates exist, scope with `:visible` or add a `:has-text(...)` qualifier",
        });
      }
    }
  }

  return issues;
}

async function chainDepth(flow: FlowFile, load: (name: string) => Promise<FlowFile>): Promise<number> {
  let depth = 1;
  let cur: FlowFile = flow;
  const seen = new Set<string>([flow.name]);
  while (cur.extends) {
    if (seen.has(cur.extends)) return depth;
    seen.add(cur.extends);
    cur = await load(cur.extends);
    depth++;
  }
  return depth;
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
