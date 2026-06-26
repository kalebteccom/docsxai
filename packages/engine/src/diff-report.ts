// Doc-pack drift detection — severity ranking and the report formatters.
//
// These render the deterministic DriftReport produced by `diffDocPacks` into the surfaces the host
// surfaces it on: markdown for PR comments, plain text for the CLI. Like the report itself, the
// formatters carry no timestamps — same report → byte-identical output — so the renderings stay
// PR-comment- and CI-gate-safe.

import {
  type DriftRegion,
  type DriftReport,
  type DriftSeverity,
  type FlowDrift,
  SEVERITY_RANK,
} from "./diff-types.js";

/** True when `severity` is at or above `threshold` (the `--fail-on` gate). */
export function severityAtLeast(severity: DriftSeverity, threshold: DriftSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const MARKER: Record<DriftSeverity, string> = {
  none: "OK",
  info: "[INFO]",
  warn: "[WARN]",
  fail: "[FAIL]",
};

function fmtRegion(r: DriftRegion): string {
  return `(x ${r.x}, y ${r.y}, ${r.width}×${r.height})`;
}

function fmtValue(v: unknown): string {
  return v === null || v === undefined ? "∅" : JSON.stringify(v);
}

function flowDetailLines(f: FlowDrift): string[] {
  const lines: string[] = [];
  if (f.steps_added.length > 0)
    lines.push(`- steps added: ${f.steps_added.map((s) => `\`${s}\``).join(", ")}`);
  if (f.steps_removed.length > 0)
    lines.push(`- steps removed: ${f.steps_removed.map((s) => `\`${s}\``).join(", ")}`);
  for (const c of f.steps_changed) {
    const deltas = c.fields
      .map((d) => `${d.field}: ${fmtValue(d.a)} → ${fmtValue(d.b)}`)
      .join("; ");
    lines.push(`- step \`${c.id}\` changed: ${deltas}`);
  }
  for (const m of f.annotations_moved) {
    lines.push(
      `- annotation moved on \`${m.step}\` (Δ ${m.delta_px}px): ` +
        `(${m.a.x},${m.a.y} ${m.a.width}×${m.a.height}) → ` +
        `(${m.b.x},${m.b.y} ${m.b.width}×${m.b.height})`,
    );
  }
  for (const s of f.screenshots) {
    if (s.status !== "changed") {
      lines.push(`- screenshot \`${s.step}.png\` ${MARKER[s.severity]}: ${s.status}`);
    } else if (s.dimension_change) {
      const d = s.dimension_change;
      lines.push(
        `- screenshot \`${s.step}.png\` ${MARKER[s.severity]}: dimensions ` +
          `${d.a.width}×${d.a.height} → ${d.b.width}×${d.b.height}`,
      );
    } else {
      lines.push(
        `- screenshot \`${s.step}.png\` ${MARKER[s.severity]}: ${s.changed_pixel_count} px ` +
          `(${s.pct}%) changed${s.region ? ` in region ${fmtRegion(s.region)}` : ""}`,
      );
    }
  }
  if (f.locators_added.length > 0)
    lines.push(`- locators added: ${f.locators_added.map((l) => `\`${l}\``).join(", ")}`);
  if (f.locators_removed.length > 0)
    lines.push(`- locators removed: ${f.locators_removed.map((l) => `\`${l}\``).join(", ")}`);
  for (const l of f.locators_changed) {
    lines.push(`- locator \`${l.name}\` changed: \`${l.a}\` → \`${l.b}\``);
  }
  for (const p of f.prose) {
    lines.push(
      p.status === "changed"
        ? `- prose \`${p.step}.md\`: +${p.lines_added} / -${p.lines_removed} lines`
        : `- prose \`${p.step}.md\`: ${p.status}`,
    );
  }
  return lines;
}

/** PR-comment-ready markdown rendering of a {@link DriftReport}. */
export function formatDriftReportMarkdown(report: DriftReport): string {
  const lines: string[] = ["# docsxai drift report", ""];
  lines.push(`\`${report.a}\` → \`${report.b}\``, "");
  if (report.flows.length === 0) {
    lines.push("No drift detected.", "");
    return lines.join("\n");
  }
  lines.push(
    "| Flow | Severity | Steps Δ | Annotations | Screenshots Δ | Locators Δ | Prose Δ |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const f of report.flows) {
    if (f.status !== "changed") {
      lines.push(`| \`${f.flow}\` | ${MARKER[f.severity]} | flow ${f.status} | — | — | — | — |`);
      continue;
    }
    const locatorCount =
      f.locators_added.length + f.locators_removed.length + f.locators_changed.length;
    lines.push(
      `| \`${f.flow}\` | ${MARKER[f.severity]} ` +
        `| +${f.steps_added.length} / -${f.steps_removed.length} / ~${f.steps_changed.length} ` +
        `| ${f.annotations_moved.length} moved | ${f.screenshots.length} | ${locatorCount} | ${f.prose.length} |`,
    );
  }
  lines.push("");
  for (const f of report.flows) {
    lines.push(`## \`${f.flow}\` ${MARKER[f.severity]}`, "");
    if (f.status !== "changed") {
      lines.push(`- flow ${f.status}`, "");
      continue;
    }
    lines.push(...flowDetailLines(f), "");
  }
  const s = report.summary;
  lines.push(
    `**Totals:** ${s.flows_changed} flow${s.flows_changed === 1 ? "" : "s"} changed · ` +
      `${s.steps_changed} step${s.steps_changed === 1 ? "" : "s"} · ` +
      `${s.screenshots_changed} screenshot${s.screenshots_changed === 1 ? "" : "s"} · ` +
      `max pixel change ${s.max_pixel_change_pct}% · severity ${s.severity}`,
    "",
  );
  return lines.join("\n");
}

/** Plain-text rendering of a {@link DriftReport} (the CLI's default `--format text`). */
export function formatDriftReportText(report: DriftReport): string {
  const lines: string[] = [`drift: ${report.a} → ${report.b}`];
  if (report.flows.length === 0) {
    lines.push("no drift detected");
    return lines.join("\n") + "\n";
  }
  for (const f of report.flows) {
    lines.push(
      `flow ${f.flow} ${MARKER[f.severity]}${f.status !== "changed" ? ` (${f.status})` : ""}`,
    );
    if (f.status === "changed") {
      for (const l of flowDetailLines(f)) lines.push(`  ${l.replace(/`/g, "")}`);
    }
  }
  const s = report.summary;
  lines.push(
    `totals: ${s.flows_changed} flows changed, ${s.steps_changed} steps, ` +
      `${s.screenshots_changed} screenshots, max pixel change ${s.max_pixel_change_pct}%, severity ${s.severity}`,
  );
  return lines.join("\n") + "\n";
}
