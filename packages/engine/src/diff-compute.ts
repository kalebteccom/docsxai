// Doc-pack drift detection — the deterministic computation half.
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
import { AnnotationsFile, type AnnotationRecord, type FlowFile } from "./doc-pack.js";
import {
  type AnnotationMove,
  DriftError,
  type DriftPolicy,
  type DriftRegion,
  type DriftReport,
  type DriftSeverity,
  type FieldDelta,
  type FlowDrift,
  type IgnoreRegion,
  type LocatorChange,
  maxSeverity,
  type PngDiffResult,
  type ProseDiff,
  type ScreenshotDiff,
  type StepChange,
} from "./diff-types.js";
import { parseFlowFile } from "./flow-file.js";
import { resolveWorkspacePath } from "./workspace.js";

// ---------------------------------------------------------------------------
// PNG pixel diff
// ---------------------------------------------------------------------------

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
  return `${r.step} ${r.index ?? 0}`;
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
