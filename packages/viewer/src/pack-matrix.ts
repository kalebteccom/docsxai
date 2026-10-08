// Matrix flows as pack sources. `docsxai run` on a flow with a `matrix:` block writes
// `docs/<flow>/<variant-id>/screenshots/<step>.png` and `docs/<flow>/<variant-id>/annotations.json`,
// one directory per cell, where the id is `<locale>.<color scheme>.<viewport name>` (axes the matrix
// does not name are left out). A pack variant key is `<locale>.<theme>.<viewport>` with a numeric
// viewport, so the two only match by chance and `pack.json` maps one to the other:
//
//   "sources": { "login-desktop": { "flow": "login", "matrix": "en-US.light.desktop-1280",
//                                   "variant": "en.light.1280" } }
//
//   "matrixFlow": { "flow": "login", "auto": true,
//                   "map": { "en-US.light.desktop-1280": "en.light.1280" } }
//
// This module checks the shape of both forms and turns them into the directories to read. The
// directory reader itself (screenshots and annotations.json) is shared with flat flows.

import { promises as fs, type Dirent } from "node:fs";
import * as path from "node:path";
import { refuseSymlinks } from "./pack-paths.js";
import { isValidId, parseVariantKey } from "./pack-schema.js";

/** A capture flow's directory name under `docs/`, as the engine's `burn` accepts it. */
export const CAPTURE_FLOW = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** A matrix variant id as a directory name: locale tags keep their capitals, viewport names their dashes. */
const MATRIX_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The per-flow screenshot directory of an unexpanded flow; never a matrix variant. */
const SCREENSHOTS_DIR = "screenshots";

type Obj = Record<string, unknown>;

/** A `sources` entry naming one matrix variant directory. */
export interface MatrixSource {
  flow: string;
  matrix: string;
  variant: string;
  /** The flow id in the pack, when the matrix flow's name is not a valid one. */
  packFlow?: string;
}

/** The `matrixFlow` block: every variant directory of one flow, mapped or auto-mapped. */
export interface MatrixFlow {
  flow: string;
  map: Record<string, string>;
  auto: boolean;
  packFlow?: string;
}

/** A directory to read and where its screenshots go in the pack. */
export interface ResolvedSource {
  /** Path under `docs/`, `/`-joined: the capture flow name, or `<flow>/<variant id>`. */
  label: string;
  segments: string[];
  /** The pack flow the screenshots feed. */
  flow: string;
  variant: string;
  /** The matrix flow's directory, for a matrix variant. */
  matrixFlow?: string;
}

function packKey(value: unknown, where: string): string {
  if (typeof value !== "string" || !parseVariantKey(value)) {
    throw new Error(`${where} must be <locale>.<theme>.<viewport>`);
  }
  return value;
}

function matrixFlowName(value: unknown, where: string): string {
  if (typeof value !== "string" || !CAPTURE_FLOW.test(value)) {
    throw new Error(`${where}.flow must be a matrix flow name`);
  }
  return value;
}

function matrixId(value: unknown, where: string): string {
  if (typeof value !== "string" || !MATRIX_ID.test(value) || value === SCREENSHOTS_DIR) {
    throw new Error(`${where} must be a matrix variant id (<locale>.<color scheme>.<viewport>)`);
  }
  return value;
}

/** The optional `packFlow`, or `undefined` when the matrix flow's own name is a pack flow id. */
function packFlowOf(e: Obj, flow: string, where: string): string | undefined {
  if (e.packFlow !== undefined) {
    if (typeof e.packFlow !== "string" || !isValidId(e.packFlow)) {
      throw new Error(`${where}.packFlow must be a flow id`);
    }
    return e.packFlow;
  }
  if (!isValidId(flow)) {
    throw new Error(
      `${where}.flow "${flow}" is not a pack flow id; set packFlow to the id the flow takes in the pack`,
    );
  }
  return undefined;
}

/** Checks a `sources` entry that carries `matrix`. `where` names it, e.g. `pack.json: sources["a"]`. */
export function parseMatrixSource(e: Obj, where: string): MatrixSource {
  const flow = matrixFlowName(e.flow, where);
  const packFlow = packFlowOf(e, flow, where);
  return {
    flow,
    matrix: matrixId(e.matrix, `${where}.matrix`),
    variant: packKey(e.variant, `${where}.variant`),
    ...(packFlow !== undefined ? { packFlow } : {}),
  };
}

/** Checks the `matrixFlow` block. `file` is the config file name, for messages. */
export function parseMatrixFlow(value: unknown, file: string): MatrixFlow {
  const where = `${file}: matrixFlow`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  const e = value as Obj;
  const flow = matrixFlowName(e.flow, where);
  const packFlow = packFlowOf(e, flow, where);
  if (e.auto !== undefined && typeof e.auto !== "boolean") {
    throw new Error(`${where}.auto must be true or false`);
  }
  const rawMap = e.map ?? {};
  if (typeof rawMap !== "object" || rawMap === null || Array.isArray(rawMap)) {
    throw new Error(`${where}.map must be an object of matrix variant id to pack key`);
  }
  const map = Object.fromEntries(
    Object.entries(rawMap as Obj).map(([id, key]) => [
      matrixId(id, `${where}.map key "${id}"`),
      packKey(key, `${where}.map["${id}"]`),
    ]),
  );
  const auto = e.auto === true;
  if (!auto && Object.keys(map).length === 0) {
    throw new Error(`${where} needs "map" entries or "auto": true`);
  }
  return { flow, map, auto, ...(packFlow !== undefined ? { packFlow } : {}) };
}

const list = (names: string[]): string => (names.length > 0 ? names.join(", ") : "none");

const byName = (a: Dirent, b: Dirent): number => (a.name < b.name ? -1 : 1);

/**
 * The variant directories `docsxai run` left under `docs/<flow>/`, sorted. A symlinked directory is
 * not one: it is left out and reported through `warn`, and a symlinked `docs/<flow>/` is refused.
 */
export async function variantIds(
  docsDir: string,
  flow: string,
  warn?: (message: string) => void,
): Promise<string[]> {
  await refuseSymlinks(docsDir, [flow]);
  const entries = await fs
    .readdir(path.join(docsDir, flow), { withFileTypes: true })
    .catch((e: unknown): Dirent[] => {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    });
  const candidates = entries.filter((d) => !d.name.startsWith(".") && d.name !== SCREENSHOTS_DIR);
  if (warn) {
    for (const d of candidates.filter((c) => c.isSymbolicLink()).sort(byName)) {
      const target = await fs.stat(path.join(docsDir, flow, d.name)).catch(() => undefined);
      if (target?.isDirectory()) {
        warn(`docs/${flow}/${d.name} is a symlink and was skipped; pack does not follow symlinks`);
      }
    }
  }
  return candidates
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function matrixSource(
  flow: string,
  id: string,
  packFlow: string | undefined,
  variant: string,
): ResolvedSource {
  return {
    label: `${flow}/${id}`,
    segments: [flow, id],
    flow: packFlow ?? flow,
    variant,
    matrixFlow: flow,
  };
}

function expandMatrixFlow(mf: MatrixFlow, have: string[], file: string): ResolvedSource[] {
  const where = `${file}: matrixFlow "${mf.flow}"`;
  if (have.length === 0) throw new Error(`${where}: no variant directories under docs/${mf.flow}/`);
  const mapped = new Map(Object.entries(mf.map));
  const missing = [...mapped.keys()].filter((id) => !have.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `${where}: map names ${list(missing)}, not under docs/${mf.flow}/ (available: ${list(have)})`,
    );
  }
  const unmapped: string[] = [];
  const out: ResolvedSource[] = [];
  for (const id of have) {
    const variant = mapped.get(id) ?? (mf.auto && parseVariantKey(id) ? id : undefined);
    if (variant === undefined) unmapped.push(id);
    else out.push(matrixSource(mf.flow, id, mf.packFlow, variant));
  }
  if (unmapped.length > 0) {
    throw new Error(
      `${where}: no pack key for ${unmapped.join(", ")}. Map each as <matrix id>: <locale>.<theme>.<viewport> in "map"${
        mf.auto ? "" : ', or set "auto": true for ids already in that form'
      }`,
    );
  }
  return out;
}

/** Two matrix variants of one flow cannot feed one pack variant: they hold the same steps. */
function rejectSharedTargets(sources: ResolvedSource[], file: string): void {
  const byTarget = new Map<string, { source: ResolvedSource; labels: string[] }>();
  for (const source of sources) {
    if (source.matrixFlow === undefined) continue;
    const key = JSON.stringify([source.matrixFlow, source.flow, source.variant]);
    const seen = byTarget.get(key) ?? { source, labels: [] };
    seen.labels.push(source.label);
    byTarget.set(key, seen);
  }
  for (const { source, labels } of byTarget.values()) {
    if (labels.length < 2) continue;
    throw new Error(
      `${file}: docs/${labels.join(", docs/")} all map to variant "${source.variant}" of pack flow "${source.flow}"`,
    );
  }
}

/**
 * The directories to read: each flat `sources` name as itself, each matrix entry as
 * `docs/<flow>/<variant id>`, and the `matrixFlow` block expanded. Throws on a matrix variant that
 * is not on disk, a variant with no pack key and two variants that share one.
 */
export async function resolveSources(
  sources: Record<string, { flow: string; variant: string } | MatrixSource>,
  matrixFlow: MatrixFlow | undefined,
  docsDir: string,
  file: string,
  warn?: (message: string) => void,
): Promise<ResolvedSource[]> {
  const out: ResolvedSource[] = [];
  const cache = new Map<string, string[]>();
  const idsOf = async (flow: string): Promise<string[]> => {
    const known = cache.get(flow) ?? (await variantIds(docsDir, flow, warn));
    cache.set(flow, known);
    return known;
  };
  for (const [name, e] of Object.entries(sources)) {
    if (!("matrix" in e)) {
      out.push({ label: name, segments: [name], flow: e.flow, variant: e.variant });
      continue;
    }
    const have = await idsOf(e.flow);
    if (!have.includes(e.matrix)) {
      throw new Error(
        `${file}: sources["${name}"]: no matrix variant "${e.matrix}" under docs/${e.flow}/ (available: ${list(have)})`,
      );
    }
    out.push(matrixSource(e.flow, e.matrix, e.packFlow, e.variant));
  }
  if (matrixFlow) {
    out.push(...expandMatrixFlow(matrixFlow, await idsOf(matrixFlow.flow), file));
  }
  rejectSharedTargets(out, file);
  return out.sort((a, b) => (a.label < b.label ? -1 : 1));
}
