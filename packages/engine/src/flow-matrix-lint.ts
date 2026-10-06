// Lint rules for the flow matrix. Pure-static, like `flow-lint.ts`, which runs them.
//   R015 (info)    — the variants the flow's `matrix` expands to, in run order
//   R016 (warning) — a `copy_by_locale` key that no variant locale can use

import type { FlowFile } from "./doc-pack.js";
import { matrixVariantIds } from "./flow-matrix.js";

export type MatrixLintIssue = {
  code: string;
  severity: "info" | "warning";
  flow: string;
  stepId?: string;
  message: string;
  suggestion?: string;
};

/** A `copy_by_locale` key serves a locale when it is that tag or its language. */
function serves(key: string, locale: string): boolean {
  const k = key.toLowerCase();
  const l = locale.toLowerCase();
  return k === l || k === l.split("-")[0];
}

export function lintMatrix(flow: FlowFile): MatrixLintIssue[] {
  const issues: MatrixLintIssue[] = [];
  if (flow.matrix) {
    const ids = matrixVariantIds(flow.matrix);
    issues.push({
      code: "R015",
      severity: "info",
      flow: flow.name,
      message: `\`matrix\` expands to ${ids.length} variant${ids.length !== 1 ? "s" : ""}: ${ids.join(", ")}`,
    });
  }
  const locales =
    flow.matrix?.locales ?? (flow.environment?.locale ? [flow.environment.locale] : []);
  for (const step of flow.steps) {
    const anns = step.annotation ? [step.annotation] : (step.annotations ?? []);
    for (const ann of anns) {
      const dead = Object.keys(ann.copy_by_locale ?? {}).filter(
        (key) => !locales.some((l) => serves(key, l)),
      );
      if (dead.length === 0) continue;
      issues.push({
        code: "R016",
        severity: "warning",
        flow: flow.name,
        stepId: step.id,
        message: `\`copy_by_locale\` key${dead.length !== 1 ? "s" : ""} ${dead.map((k) => `\`${k}\``).join(", ")} match${dead.length === 1 ? "es" : ""} no variant locale (${locales.length ? locales.join(", ") : "the flow has no matrix locales and no environment.locale"}), so ${dead.length !== 1 ? "they are" : "it is"} never used`,
        suggestion:
          "add the locale to `matrix.locales` (or set `environment.locale`), or fix the key to a tag or language the flow runs",
      });
    }
  }
  return issues;
}
