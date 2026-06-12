// Doc-pack drift detection — deterministic diff between two doc-pack directories.
//
// The engine DETECTS drift and reports it; proposing flow-file patches is the host agent's
// calibration-time job (`diagnose` feeds that loop). `docsxai baseline` snapshots a doc pack;
// `docsxai diff` compares the live workspace against it and emits this module's DriftReport —
// per flow: step deltas (id-keyed field changes), annotation moves (bounding-box delta beyond a
// pixel tolerance), screenshot pixel diffs (pngjs, exact RGBA compare, ignore-region aware),
// prose line-change counts, and locator changes. Reports carry no timestamps: same two doc packs
// → byte-identical report, which is what makes the report PR-comment- and CI-gate-safe.

import { promises as fs } from "node:fs";
import { PNG } from "pngjs";
import {
  AnnotationsFile,
  type AnnotationRecord,
  type BoundingBox,
  type FlowFile,
} from "./doc-pack.js";
import { parseFlowFile } from "./flow-file.js";
import { resolveWorkspacePath } from "./workspace.js";

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

export type DriftSeverity = "none" | "info" | "warn" | "fail";

const SEVERITY_RANK: Record<DriftSeverity, number> = { none: 0, info: 1, warn: 2, fail: 3 };

function maxSeverity(a: DriftSeverity, b: DriftSeverity): DriftSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** True when `severity` is at or above `threshold` (the `--fail-on` gate). */
export function severityAtLeast(severity: DriftSeverity, threshold: DriftSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

export interface DriftRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle excluded from a specific screenshot's pixel diff (a clock widget, an ad slot, …). */
export interface IgnoreRegion {
  flow: string;
  step: string;
  region: DriftRegion;
}

export interface DriftPolicy {
  /** Pixel-change percentage at/above which a screenshot diff is `warn`. Default 1. */
  screenshot_pct_warn?: number;
  /** Pixel-change percentage at/above which a screenshot diff is `fail`. Default 5. */
  screenshot_pct_fail?: number;
  /** Annotation bounding-box delta (px, max over x/y/width/height) tolerated before "moved". Default 2. */
  annotation_move_tolerance_px?: number;
  /** Regions excluded from the pixel diff of the named flow/step screenshots. */
  ignore_regions?: IgnoreRegion[];
}

export interface FieldDelta {
  field: string;
  a: unknown;
  b: unknown;
}

export interface StepChange {
  id: string;
  fields: FieldDelta[];
}

export interface AnnotationMove {
  step: string;
  copy: string;
  a: BoundingBox;
  b: BoundingBox;
  /** Max absolute delta across x / y / width / height, in image pixels. */
  delta_px: number;
}

export interface DimensionChange {
  a: { width: number; height: number };
  b: { width: number; height: number };
}

export interface ScreenshotDiff {
  step: string;
  status: "added" | "removed" | "changed";
  /** Set (instead of pixel counts) when the two PNGs have different dimensions. */
  dimension_change?: DimensionChange;
  changed_pixel_count?: number;
  /** Changed pixels as a percentage of the full image, rounded to 4 decimals. */
  pct?: number;
  /** Bounding box of all changed pixels; absent when nothing comparable changed. */
  region?: DriftRegion;
  severity: Exclude<DriftSeverity, "none">;
}

export interface ProseDiff {
  step: string;
  status: "added" | "removed" | "changed";
  lines_added: number;
  lines_removed: number;
}

export interface LocatorChange {
  name: string;
  a: string;
  b: string;
}

export interface FlowDrift {
  flow: string;
  status: "added" | "removed" | "changed";
  steps_added: string[];
  steps_removed: string[];
  steps_changed: StepChange[];
  annotations_moved: AnnotationMove[];
  screenshots: ScreenshotDiff[];
  prose: ProseDiff[];
  locators_added: string[];
  locators_removed: string[];
  locators_changed: LocatorChange[];
  severity: Exclude<DriftSeverity, "none">;
}

export interface DriftSummary {
  flows_changed: number;
  /** Steps added + removed + field-changed, across all flows. */
  steps_changed: number;
  screenshots_changed: number;
  max_pixel_change_pct: number;
  severity: DriftSeverity;
}

export interface DriftReport {
  schema: "docsxai/drift@1";
  a: string;
  b: string;
  /** Only flows with drift appear; sorted by flow name. */
  flows: FlowDrift[];
  summary: DriftSummary;
}

export class DriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftError";
  }
}

// ---------------------------------------------------------------------------
// PNG pixel diff
// ---------------------------------------------------------------------------

export type PngDiffResult =
  | {
      kind: "dimension-change";
      a: { width: number; height: number };
      b: { width: number; height: number };
    }
  | { kind: "pixels"; changed_pixel_count: number; pct: number; region: DriftRegion | null };

/**
 * Exact-RGBA pixel diff between two PNG buffers. Dimension mismatch is reported distinctly (no
 * pixel comparison is meaningful across sizes). `ignoreRegions` rectangles are excluded from the
 * comparison; `pct` is changed pixels over the FULL image area, rounded to 4 decimals.
 */
export function diffPngBuffers(
  aPng: Buffer,
  bPng: Buffer,
  ignoreRegions: DriftRegion[] = [],
): PngDiffResult {
  const a = PNG.sync.read(aPng);
  const b = PNG.sync.read(bPng);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      kind: "dimension-change",
      a: { width: a.width, height: a.height },
      b: { width: b.width, height: b.height },
    };
  }
  const ignored = (x: number, y: number): boolean =>
    ignoreRegions.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  let count = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (ignoreRegions.length > 0 && ignored(x, y)) continue;
      const i = (y * a.width + x) * 4;
      if (
        a.data[i] !== b.data[i] ||
        a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] ||
        a.data[i + 3] !== b.data[i + 3]
      ) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pct = Math.round((count / (a.width * a.height)) * 100 * 10000) / 10000;
  const region =
    count > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  return { kind: "pixels", changed_pixel_count: count, pct, region };
}

// ---------------------------------------------------------------------------
// Prose line diff (LCS — step write-ups are small)
// ---------------------------------------------------------------------------

function lineDiffCounts(aText: string, bText: string): { added: number; removed: number } {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const m = a.length;
  const n = b.length;
  const w = n + 1;
  const dp = new Uint32Array((m + 1) * w);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * w + j] =
        a[i - 1] === b[j - 1]
          ? dp[(i - 1) * w + (j - 1)]! + 1
          : Math.max(dp[(i - 1) * w + j]!, dp[i * w + (j - 1)]!);
    }
  }
  const lcs = dp[m * w + n]!;
  return { added: n - lcs, removed: m - lcs };
}

// ---------------------------------------------------------------------------
// Pack reading
// ---------------------------------------------------------------------------

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

async function listDir(p: string): Promise<string[]> {
  try {
    return (await fs.readdir(p)).sort();
  } catch {
    return [];
  }
}

async function flowNames(dir: string): Promise<string[]> {
  const entries = await listDir(resolveWorkspacePath(dir, "flows"));
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .map((e) => e.slice(0, -".flow.yaml".length));
}

async function loadFlow(dir: string, name: string): Promise<FlowFile> {
  const p = resolveWorkspacePath(dir, "flows", `${name}.flow.yaml`);
  return parseFlowFile(await fs.readFile(p, "utf8"), p);
}

async function loadAnnotations(dir: string, flow: string): Promise<AnnotationRecord[]> {
  const raw = await readIfExists(resolveWorkspacePath(dir, "docs", flow, "annotations.json"));
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    throw new DriftError(`docs/${flow}/annotations.json: not valid JSON — ${(e as Error).message}`);
  }
  const result = AnnotationsFile.safeParse(parsed);
  if (!result.success) {
    throw new DriftError(`docs/${flow}/annotations.json: invalid annotations file`);
  }
  return result.data.annotations;
}

// ---------------------------------------------------------------------------
// Per-flow comparison
// ---------------------------------------------------------------------------

const STEP_FIELDS = [
  "action",
  "optional",
  "target",
  "value",
  "wait_for",
  "success",
  "annotation",
  "annotations",
  "redactions",
] as const;

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diffSteps(
  a: FlowFile,
  b: FlowFile,
): { added: string[]; removed: string[]; changed: StepChange[] } {
  const aById = new Map(a.steps.map((s) => [s.id, s]));
  const bById = new Map(b.steps.map((s) => [s.id, s]));
  const added = [...bById.keys()].filter((id) => !aById.has(id)).sort();
  const removed = [...aById.keys()].filter((id) => !bById.has(id)).sort();
  const changed: StepChange[] = [];
  // Walk in b's step order (the current pack) for a stable, reader-meaningful sequence.
  for (const step of b.steps) {
    const prior = aById.get(step.id);
    if (!prior) continue;
    const fields: FieldDelta[] = [];
    for (const field of STEP_FIELDS) {
      const av = prior[field];
      const bv = step[field];
      if (!jsonEqual(av, bv)) fields.push({ field, a: av ?? null, b: bv ?? null });
    }
    if (fields.length > 0) changed.push({ id: step.id, fields });
  }
  return { added, removed, changed };
}

function diffLocators(
  a: FlowFile,
  b: FlowFile,
): { added: string[]; removed: string[]; changed: LocatorChange[] } {
  const aLoc = a.locators;
  const bLoc = b.locators;
  const added = Object.keys(bLoc)
    .filter((k) => !(k in aLoc))
    .sort();
  const removed = Object.keys(aLoc)
    .filter((k) => !(k in bLoc))
    .sort();
  const changed = Object.keys(aLoc)
    .filter((k) => k in bLoc && aLoc[k] !== bLoc[k])
    .sort()
    .map((name) => ({ name, a: aLoc[name]!, b: bLoc[name]! }));
  return { added, removed, changed };
}

function annotationKey(r: AnnotationRecord): string {
  return `${r.step} ${r.index ?? 0}`;
}

function diffAnnotationPositions(
  a: AnnotationRecord[],
  b: AnnotationRecord[],
  tolerancePx: number,
): AnnotationMove[] {
  const aByKey = new Map(a.map((r) => [annotationKey(r), r]));
  const moves: AnnotationMove[] = [];
  for (const rec of b) {
    const prior = aByKey.get(annotationKey(rec));
    if (!prior?.bounding_box || !rec.bounding_box) continue;
    const pa = prior.bounding_box;
    const pb = rec.bounding_box;
    const delta = Math.max(
      Math.abs(pa.x - pb.x),
      Math.abs(pa.y - pb.y),
      Math.abs(pa.width - pb.width),
      Math.abs(pa.height - pb.height),
    );
    if (delta > tolerancePx) {
      moves.push({ step: rec.step, copy: rec.copy, a: pa, b: pb, delta_px: delta });
    }
  }
  return moves;
}

async function diffScreenshots(
  aDir: string,
  bDir: string,
  flow: string,
  policy: Required<Pick<DriftPolicy, "screenshot_pct_warn" | "screenshot_pct_fail">>,
  ignoreRegions: IgnoreRegion[],
): Promise<ScreenshotDiff[]> {
  const aShots = (await listDir(resolveWorkspacePath(aDir, "docs", flow, "screenshots"))).filter(
    (f) => f.endsWith(".png"),
  );
  const bShots = (await listDir(resolveWorkspacePath(bDir, "docs", flow, "screenshots"))).filter(
    (f) => f.endsWith(".png"),
  );
  const names = [...new Set([...aShots, ...bShots])].sort();
  const out: ScreenshotDiff[] = [];
  for (const name of names) {
    const step = name.slice(0, -".png".length);
    const inA = aShots.includes(name);
    const inB = bShots.includes(name);
    if (!inA || !inB) {
      out.push({ step, status: inB ? "added" : "removed", severity: "warn" });
      continue;
    }
    const aPng = await fs.readFile(resolveWorkspacePath(aDir, "docs", flow, "screenshots", name));
    const bPng = await fs.readFile(resolveWorkspacePath(bDir, "docs", flow, "screenshots", name));
    const regions = ignoreRegions
      .filter((r) => r.flow === flow && r.step === step)
      .map((r) => r.region);
    const diff = diffPngBuffers(aPng, bPng, regions);
    if (diff.kind === "dimension-change") {
      out.push({
        step,
        status: "changed",
        dimension_change: { a: diff.a, b: diff.b },
        severity: "fail",
      });
      continue;
    }
    if (diff.changed_pixel_count === 0) continue;
    const severity: ScreenshotDiff["severity"] =
      diff.pct >= policy.screenshot_pct_fail
        ? "fail"
        : diff.pct >= policy.screenshot_pct_warn
          ? "warn"
          : "info";
    out.push({
      step,
      status: "changed",
      changed_pixel_count: diff.changed_pixel_count,
      pct: diff.pct,
      ...(diff.region ? { region: diff.region } : {}),
      severity,
    });
  }
  return out;
}

async function diffProse(aDir: string, bDir: string, flow: string): Promise<ProseDiff[]> {
  const isStepMd = (f: string) => f.endsWith(".md");
  const aMds = (await listDir(resolveWorkspacePath(aDir, "docs", flow))).filter(isStepMd);
  const bMds = (await listDir(resolveWorkspacePath(bDir, "docs", flow))).filter(isStepMd);
  const names = [...new Set([...aMds, ...bMds])].sort();
  const out: ProseDiff[] = [];
  for (const name of names) {
    const step = name.slice(0, -".md".length);
    const aText = await readIfExists(resolveWorkspacePath(aDir, "docs", flow, name));
    const bText = await readIfExists(resolveWorkspacePath(bDir, "docs", flow, name));
    if (aText === null || bText === null) {
      const text = (aText ?? bText)!.toString("utf8");
      const lines = text === "" ? 0 : text.split("\n").length;
      out.push({
        step,
        status: bText !== null ? "added" : "removed",
        lines_added: bText !== null ? lines : 0,
        lines_removed: aText !== null ? lines : 0,
      });
      continue;
    }
    if (aText.equals(bText)) continue;
    const { added, removed } = lineDiffCounts(aText.toString("utf8"), bText.toString("utf8"));
    out.push({ step, status: "changed", lines_added: added, lines_removed: removed });
  }
  return out;
}

// ---------------------------------------------------------------------------
// diffDocPacks
// ---------------------------------------------------------------------------

/**
 * Diff two doc-pack directories (each a workspace-shaped tree: `flows/` + `docs/`). `aDir` is the
 * baseline ("before"), `bDir` the candidate ("after"). Pure file → JSON transform; deterministic
 * (no timestamps); never writes.
 */
export async function diffDocPacks(
  aDir: string,
  bDir: string,
  options: DriftPolicy = {},
): Promise<DriftReport> {
  const policy = {
    screenshot_pct_warn: options.screenshot_pct_warn ?? 1,
    screenshot_pct_fail: options.screenshot_pct_fail ?? 5,
  };
  const tolerance = options.annotation_move_tolerance_px ?? 2;
  const ignoreRegions = options.ignore_regions ?? [];

  const aFlows = await flowNames(aDir);
  const bFlows = await flowNames(bDir);
  const names = [...new Set([...aFlows, ...bFlows])].sort();

  const flows: FlowDrift[] = [];
  for (const name of names) {
    const inA = aFlows.includes(name);
    const inB = bFlows.includes(name);
    const empty = {
      steps_added: [] as string[],
      steps_removed: [] as string[],
      steps_changed: [] as StepChange[],
      annotations_moved: [] as AnnotationMove[],
      screenshots: [] as ScreenshotDiff[],
      prose: [] as ProseDiff[],
      locators_added: [] as string[],
      locators_removed: [] as string[],
      locators_changed: [] as LocatorChange[],
    };
    if (!inA || !inB) {
      flows.push({ flow: name, status: inB ? "added" : "removed", ...empty, severity: "warn" });
      continue;
    }

    const aFlow = await loadFlow(aDir, name);
    const bFlow = await loadFlow(bDir, name);
    const steps = diffSteps(aFlow, bFlow);
    const locators = diffLocators(aFlow, bFlow);
    const annotationsMoved = diffAnnotationPositions(
      await loadAnnotations(aDir, name),
      await loadAnnotations(bDir, name),
      tolerance,
    );
    const screenshots = await diffScreenshots(aDir, bDir, name, policy, ignoreRegions);
    const prose = await diffProse(aDir, bDir, name);

    const structural =
      steps.added.length +
        steps.removed.length +
        steps.changed.length +
        locators.added.length +
        locators.removed.length +
        locators.changed.length +
        annotationsMoved.length +
        prose.length >
      0;
    let severity: DriftSeverity = structural ? "warn" : "none";
    for (const s of screenshots) severity = maxSeverity(severity, s.severity);
    if (severity === "none") continue; // no drift in this flow

    flows.push({
      flow: name,
      status: "changed",
      steps_added: steps.added,
      steps_removed: steps.removed,
      steps_changed: steps.changed,
      annotations_moved: annotationsMoved,
      screenshots,
      prose,
      locators_added: locators.added,
      locators_removed: locators.removed,
      locators_changed: locators.changed,
      severity: severity,
    });
  }

  let summarySeverity: DriftSeverity = "none";
  let stepsChanged = 0;
  let screenshotsChanged = 0;
  let maxPct = 0;
  for (const f of flows) {
    summarySeverity = maxSeverity(summarySeverity, f.severity);
    stepsChanged += f.steps_added.length + f.steps_removed.length + f.steps_changed.length;
    screenshotsChanged += f.screenshots.length;
    for (const s of f.screenshots) if (s.pct !== undefined && s.pct > maxPct) maxPct = s.pct;
  }

  return {
    schema: "docsxai/drift@1",
    a: aDir,
    b: bDir,
    flows,
    summary: {
      flows_changed: flows.length,
      steps_changed: stepsChanged,
      screenshots_changed: screenshotsChanged,
      max_pixel_change_pct: maxPct,
      severity: summarySeverity,
    },
  };
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
