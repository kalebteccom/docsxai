// Byte comparison of two run roots for `run --verify-determinism`. Every file under the roots is an
// artefact (annotations.json, screenshots, step markdown, locators, halt context). Equal bytes pass;
// otherwise the comparator says where the two files first part ways, in terms an author can act on:
// a JSON key path, the bounding box of the changed pixels of a PNG, the first differing line of a
// text file, or the sizes. Pure over the file contents and ordered by ordinal path, so the same two
// roots always produce the same differences in the same order.

import { promises as fs } from "node:fs";
import { diffPngBuffers, type DimensionChange, type DriftRegion } from "./diff.js";
import { byOrdinal, listTree } from "./verify-tree.js";
import { resolveWorkspacePath } from "./workspace.js";

export type DifferenceKind = "missing" | "extra" | "json" | "png" | "text" | "bytes";

export interface ArtefactDifference {
  /** Root-relative, `/`-separated. */
  path: string;
  /** The run that disagreed with run 1 (2 and up). */
  run: number;
  kind: DifferenceKind;
  /** One line a person can act on. */
  hint: string;
  size?: { a: number; b: number };
  /** `json`: where the two documents first differ, e.g. `annotations[0].bounding_box.x`. */
  json_path?: string;
  /** `png`: bounding box of the changed pixels. */
  region?: DriftRegion;
  changed_pixel_count?: number;
  dimension_change?: DimensionChange;
  /** `text`: 1-based line of the first difference. */
  line?: number;
}

export type ContentDifference = Omit<ArtefactDifference, "path" | "run">;

const MAX_SHOWN = 60;

function show(v: unknown): string {
  const s = v === undefined ? "(absent)" : JSON.stringify(v);
  return s.length > MAX_SHOWN ? `${s.slice(0, MAX_SHOWN - 1)}…` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First difference between two parsed JSON values, in a stable order: array indices ascending, object keys ordinal. */
export function firstJsonDifference(
  a: unknown,
  b: unknown,
  at = "",
): { path: string; a: unknown; b: unknown } | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = firstJsonDifference(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byOrdinal);
    for (const k of keys) {
      const d = firstJsonDifference(a[k], b[k], at === "" ? k : `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : { path: at === "" ? "(root)" : at, a, b };
}

function sizeHint(a: Buffer, b: Buffer): string {
  if (a.length !== b.length) return `size differs (${a.length} vs ${b.length} bytes)`;
  let i = 0;
  while (a[i] === b[i]) i++;
  return `same size (${a.length} bytes), first differing byte at offset ${i}`;
}

function compareJson(a: Buffer, b: Buffer): ContentDifference | null {
  let pa: unknown;
  let pb: unknown;
  try {
    pa = JSON.parse(a.toString("utf8"));
    pb = JSON.parse(b.toString("utf8"));
  } catch {
    return null;
  }
  const d = firstJsonDifference(pa, pb);
  if (!d) {
    return {
      kind: "json",
      hint: `same JSON data, bytes differ (key order or formatting): ${sizeHint(a, b)}`,
      size: { a: a.length, b: b.length },
    };
  }
  return {
    kind: "json",
    hint: `key ${d.path} differs: ${show(d.a)} vs ${show(d.b)}`,
    json_path: d.path,
    size: { a: a.length, b: b.length },
  };
}

function comparePng(a: Buffer, b: Buffer): ContentDifference | null {
  let result: ReturnType<typeof diffPngBuffers>;
  try {
    result = diffPngBuffers(a, b);
  } catch {
    return null;
  }
  const size = { a: a.length, b: b.length };
  if (result.kind === "dimension-change") {
    const { a: da, b: db } = result;
    return {
      kind: "png",
      hint: `image size differs (${da.width}x${da.height} vs ${db.width}x${db.height} px)`,
      dimension_change: { a: da, b: db },
      size,
    };
  }
  if (result.changed_pixel_count === 0) {
    return {
      kind: "png",
      hint: `pixels identical, file bytes differ (encoder output or metadata): ${sizeHint(a, b)}`,
      size,
    };
  }
  const r = result.region!;
  return {
    kind: "png",
    hint: `${result.changed_pixel_count} pixels differ (${result.pct}%) inside x=${r.x} y=${r.y} ${r.width}x${r.height}`,
    changed_pixel_count: result.changed_pixel_count,
    region: r,
    size,
  };
}

function compareText(a: Buffer, b: Buffer): ContentDifference {
  const la = a.toString("utf8").split("\n");
  const lb = b.toString("utf8").split("\n");
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  if (i === la.length && i === lb.length) return bytesDifference(a, b); // differs only in invalid UTF-8
  return {
    kind: "text",
    hint: `line ${i + 1} differs: ${show(la[i])} vs ${show(lb[i])}`,
    line: i + 1,
    size: { a: a.length, b: b.length },
  };
}

function bytesDifference(a: Buffer, b: Buffer): ContentDifference {
  return { kind: "bytes", hint: sizeHint(a, b), size: { a: a.length, b: b.length } };
}

/** Compare one artefact's two byte strings. `null` when they are identical. */
export function compareArtefactBytes(
  artefactPath: string,
  a: Buffer,
  b: Buffer,
): ContentDifference | null {
  if (a.equals(b)) return null;
  const ext = artefactPath.slice(artefactPath.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return comparePng(a, b) ?? bytesDifference(a, b);
  if (ext === ".json") return compareJson(a, b) ?? bytesDifference(a, b);
  if ([".md", ".yaml", ".yml", ".txt"].includes(ext)) return compareText(a, b);
  return bytesDifference(a, b);
}

export interface TreeComparison {
  /** Artefacts in run 1, the side every other run is compared against. */
  compared: number;
  differences: ArtefactDifference[];
}

/** Compare run root `a` (run 1) with run root `b` (run `run`). Differences come out in ordinal path order. */
export async function compareRunRoots(
  aRoot: string,
  bRoot: string,
  run: number,
): Promise<TreeComparison> {
  const [la, lb] = await Promise.all([listTree(aRoot), listTree(bRoot)]);
  const inA = new Set(la.files);
  const inB = new Set(lb.files);
  const all = [...new Set([...la.files, ...lb.files])].sort(byOrdinal);
  const differences: ArtefactDifference[] = [];
  for (const rel of all) {
    if (!inB.has(rel)) {
      differences.push({
        path: rel,
        run,
        kind: "missing",
        hint: `present in run 1, absent in run ${run}`,
      });
      continue;
    }
    if (!inA.has(rel)) {
      differences.push({
        path: rel,
        run,
        kind: "extra",
        hint: `absent in run 1, present in run ${run}`,
      });
      continue;
    }
    const segments = rel.split("/");
    const [a, b] = await Promise.all([
      fs.readFile(resolveWorkspacePath(aRoot, ...segments)),
      fs.readFile(resolveWorkspacePath(bRoot, ...segments)),
    ]);
    const d = compareArtefactBytes(rel, a, b);
    if (d) differences.push({ path: rel, run, ...d });
  }
  return { compared: la.files.length, differences };
}

/** Compare run 1 against every other run. Differences are ordered by path, then by run. */
export async function compareRuns(roots: string[]): Promise<TreeComparison> {
  const [first, ...rest] = roots;
  if (first === undefined) return { compared: 0, differences: [] };
  let compared = 0;
  const differences: ArtefactDifference[] = [];
  for (const [i, root] of rest.entries()) {
    const c = await compareRunRoots(first, root, i + 2);
    compared = Math.max(compared, c.compared);
    differences.push(...c.differences);
  }
  differences.sort((x, y) => byOrdinal(x.path, y.path) || x.run - y.run);
  return { compared, differences };
}
