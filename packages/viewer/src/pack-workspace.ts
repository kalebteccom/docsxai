// A docsxai workspace as a pack source. `docsxai run` leaves clean screenshots and annotation
// records under `docs/<capture-flow>/`; `<workspace>/pack.json` says which logical flow and variant
// each capture flow feeds and holds the text a reader sees:
//
//   {
//     "schema": "docsxai/pack-config@1",
//     "sources": { "desktop-1280": { "flow": "app", "variant": "en.dark.1280" },
//                  "mobile-390":   { "flow": "app", "variant": "en.dark.390" } },
//     "flows": { "app": { "title": { "en": "..." },
//                         "steps": { "board": { "alt": { "en": "..." }, "caption": { "en": "..." } } } } }
//   }
//
// Every screenshot under a source needs a `steps` entry, and every `steps` entry needs a
// screenshot, so a page added or dropped in the flows stops the pack until the text follows.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnnotationRecord } from "./annotations.js";
import { calloutsOf } from "./pack-annotations.js";
import {
  CAPTURE_FLOW,
  parseMatrixFlow,
  parseMatrixSource,
  resolveSources,
  variantIds,
  type MatrixFlow,
  type MatrixSource,
  type ResolvedSource,
} from "./pack-matrix.js";
import {
  readJsonObject,
  readLocalized,
  type PackSource,
  type SourceFlow,
  type SourceStep,
} from "./pack-source.js";
import { nameList, printable, refuseSymlinks, showingPath } from "./pack-paths.js";
import { isValidId, parseVariantKey, type LocalizedText } from "./pack-schema.js";
import { MAX_PNG_BYTES, readRegularFile } from "./safe-read.js";

export const PACK_CONFIG_SCHEMA = "docsxai/pack-config@1";
export const PACK_CONFIG_FILE = "pack.json";

type Obj = Record<string, unknown>;

/** Names that clash with `Object.prototype` members; refused as `sources` keys. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export interface PackConfig {
  /**
   * Capture flow name → where its screenshots go in the pack. An entry with `matrix` names one
   * variant directory of a matrix flow instead, and its key is only a label.
   */
  sources: Record<string, { flow: string; variant: string } | MatrixSource>;
  /** Every variant directory of one matrix flow, mapped to pack keys. */
  matrixFlow?: MatrixFlow;
  flows: Record<
    string,
    {
      title?: LocalizedText;
      steps: Record<string, { alt: LocalizedText; caption?: LocalizedText }>;
    }
  >;
}

/** Sets an own property, even for `__proto__`, which a plain assignment would turn into a prototype change. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function objectAt(value: unknown, label: string): Obj {
  if (!isObj(value)) throw new Error(`${PACK_CONFIG_FILE}: ${label} must be an object`);
  return value;
}

/** A `docs/` directory name some `pack.json` entry reads, and how a message names that entry. */
interface DirUse {
  dir: string;
  entry: string;
}

/** Two entries that name directories differing only by case read one directory on a case-insensitive disk. */
function rejectDirClashes(uses: DirUse[]): void {
  const seen = new Map<string, DirUse>();
  for (const use of uses) {
    const earlier = seen.get(use.dir.toLowerCase());
    if (earlier !== undefined && earlier.dir !== use.dir) {
      throw new Error(`${PACK_CONFIG_FILE}: ${earlier.entry} and ${use.entry} differ only by case`);
    }
    if (earlier === undefined) seen.set(use.dir.toLowerCase(), use);
  }
}

/** Checks the shape of `pack.json`. Text rules (locales, lengths, alt coverage) are the pack validator's. */
export function parsePackConfig(raw: Obj): PackConfig {
  if (raw.schema !== PACK_CONFIG_SCHEMA) {
    throw new Error(`${PACK_CONFIG_FILE}: schema must be "${PACK_CONFIG_SCHEMA}"`);
  }
  const sources: PackConfig["sources"] = {};
  const seen = new Map<string, string>();
  const dirUses: DirUse[] = [];
  const matrixFlow =
    raw.matrixFlow !== undefined ? parseMatrixFlow(raw.matrixFlow, PACK_CONFIG_FILE) : undefined;
  const rawSources =
    raw.sources === undefined && matrixFlow ? {} : objectAt(raw.sources, "sources");
  for (const [name, entry] of Object.entries(rawSources)) {
    // `sources[name] = ...` with `__proto__` sets the prototype and the entry silently vanishes.
    if (RESERVED_NAMES.has(name)) {
      throw new Error(
        `${PACK_CONFIG_FILE}: sources["${name}"] is a reserved name (not allowed: ${[...RESERVED_NAMES].join(", ")})`,
      );
    }
    // Two names that differ only by case are one `docs/<name>/` directory on a case-insensitive disk.
    const clash = seen.get(name.toLowerCase());
    if (clash !== undefined) {
      throw new Error(
        `${PACK_CONFIG_FILE}: sources["${clash}"] and sources["${name}"] differ only by case`,
      );
    }
    seen.set(name.toLowerCase(), name);
    const e = objectAt(entry, `sources["${name}"]`);
    if (!CAPTURE_FLOW.test(name))
      throw new Error(`${PACK_CONFIG_FILE}: sources["${name}"] is not a flow name`);
    if (e.matrix !== undefined) {
      const matrixSource = parseMatrixSource(e, `${PACK_CONFIG_FILE}: sources["${name}"]`);
      sources[name] = matrixSource;
      dirUses.push({
        dir: matrixSource.flow,
        entry: `sources["${name}"].flow "${matrixSource.flow}"`,
      });
      continue;
    }
    if (typeof e.flow !== "string" || !isValidId(e.flow)) {
      throw new Error(`${PACK_CONFIG_FILE}: sources["${name}"].flow must be a flow id`);
    }
    if (typeof e.variant !== "string" || !parseVariantKey(e.variant)) {
      throw new Error(
        `${PACK_CONFIG_FILE}: sources["${name}"].variant must be <locale>.<theme>.<viewport>`,
      );
    }
    sources[name] = { flow: e.flow, variant: e.variant };
    dirUses.push({ dir: name, entry: `sources["${name}"]` });
  }
  if (matrixFlow) {
    dirUses.push({ dir: matrixFlow.flow, entry: `matrixFlow "${matrixFlow.flow}"` });
  }
  rejectDirClashes(dirUses);
  if (Object.keys(sources).length === 0 && !matrixFlow) {
    throw new Error(`${PACK_CONFIG_FILE}: sources is empty`);
  }
  const flows: PackConfig["flows"] = {};
  for (const [id, entry] of Object.entries(objectAt(raw.flows, "flows"))) {
    const f = objectAt(entry, `flows["${id}"]`);
    const steps: PackConfig["flows"][string]["steps"] = {};
    for (const [stepId, stepEntry] of Object.entries(objectAt(f.steps, `flows["${id}"].steps`))) {
      const s = objectAt(stepEntry, `flows["${id}"].steps["${stepId}"]`);
      const where = `${PACK_CONFIG_FILE} flows["${id}"].steps["${stepId}"]`;
      setOwn(steps, stepId, {
        alt: readLocalized(s.alt, `${where}.alt`),
        ...(s.caption !== undefined
          ? { caption: readLocalized(s.caption, `${where}.caption`) }
          : {}),
      });
    }
    setOwn(flows, id, {
      steps,
      ...(f.title !== undefined
        ? { title: readLocalized(f.title, `${PACK_CONFIG_FILE} flows["${id}"].title`) }
        : {}),
    });
  }
  return { sources, ...(matrixFlow ? { matrixFlow } : {}), flows };
}

async function annotationsOf(flowDir: string, shownDir: string): Promise<AnnotationRecord[]> {
  const shown = `${shownDir}/annotations.json`;
  const parsed = await readJsonObject(path.join(flowDir, "annotations.json"), true, shown);
  if (parsed.annotations === undefined) return [];
  if (!Array.isArray(parsed.annotations)) throw new Error(`${shown}: annotations must be an array`);
  return (parsed.annotations as unknown[]).filter(isObj) as unknown as AnnotationRecord[];
}

/**
 * Collects one capture directory's screenshots into the logical flow they feed. A flat flow's
 * directory is `docs/<flow>/`, a matrix variant's `docs/<flow>/<variant id>/`; both hold
 * `screenshots/` and `annotations.json`.
 */
async function addSource(
  config: PackConfig,
  docsDir: string,
  source: ResolvedSource,
  into: Map<string, Map<string, SourceStep>>,
): Promise<void> {
  const { flow, variant, label } = source;
  const shownDir = `docs/${source.segments.join("/")}`;
  const flowDir = path.join(docsDir, ...source.segments);
  await refuseSymlinks(docsDir, [...source.segments, "screenshots"]);
  const shots = (await fs.readdir(path.join(flowDir, "screenshots")).catch(() => [] as string[]))
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (shots.length === 0) {
    // A matrix flow keeps its screenshots one level down; point at the entry that reads them.
    const variants = source.matrixFlow === undefined ? await variantIds(docsDir, label) : [];
    throw new Error(
      `no screenshots under ${shownDir}/screenshots` +
        (variants.length > 0
          ? `; docs/${label}/ has variant directories (${nameList(variants)}), so it looks like a matrix flow: use a "matrix" source or "matrixFlow" in ${PACK_CONFIG_FILE}`
          : ""),
    );
  }
  const records = await annotationsOf(flowDir, shownDir);
  const steps = into.get(flow) ?? new Map<string, SourceStep>();
  into.set(flow, steps);
  for (const file of shots) {
    const id = file.replace(/\.png$/, "");
    // Own keys only: a flow or step named `constructor` finds `Object`'s members otherwise.
    const flowText = Object.hasOwn(config.flows, flow) ? config.flows[flow] : undefined;
    const text = flowText && Object.hasOwn(flowText.steps, id) ? flowText.steps[id] : undefined;
    if (!text)
      throw new Error(
        `${PACK_CONFIG_FILE} has no flows["${flow}"].steps["${printable(id)}"] (screenshot ${label}/${printable(file)})`,
      );
    const step = steps.get(id) ?? { id, ...text, variants: [] };
    if (step.variants.some((v) => v.key === variant)) {
      throw new Error(`${PACK_CONFIG_FILE}: two sources feed ${flow}/${printable(id)}/${variant}`);
    }
    const annotations = records.filter((r) => r.step === id);
    step.variants.push({
      key: variant,
      png: await showingPath(`${shownDir}/screenshots/${printable(file)}`, () =>
        readRegularFile(path.join(flowDir, "screenshots", file), MAX_PNG_BYTES),
      ),
      annotations,
      callouts: calloutsOf(annotations),
    });
    steps.set(id, step);
  }
}

/** Reads `<workspace>/pack.json` and the screenshots it points at. */
export async function readWorkspace(
  workspace: string,
  warn?: (message: string) => void,
): Promise<PackSource> {
  const config = parsePackConfig(
    await readJsonObject(path.join(workspace, PACK_CONFIG_FILE), false, PACK_CONFIG_FILE),
  );
  const docsDir = path.join(workspace, "docs");
  const into = new Map<string, Map<string, SourceStep>>();
  for (const source of await resolveSources(
    config.sources,
    config.matrixFlow,
    docsDir,
    PACK_CONFIG_FILE,
    warn,
  ))
    await addSource(config, docsDir, source, into);
  const flows: SourceFlow[] = [];
  for (const [id, text] of Object.entries(config.flows).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const steps = into.get(id);
    if (!steps) throw new Error(`${PACK_CONFIG_FILE}: flows["${id}"] has no source feeding it`);
    for (const stepId of Object.keys(text.steps)) {
      if (!steps.has(stepId))
        throw new Error(`${PACK_CONFIG_FILE}: flows["${id}"].steps["${stepId}"] has no screenshot`);
    }
    flows.push({
      id,
      ...(text.title ? { title: text.title } : {}),
      steps: [...steps.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
  }
  return flows;
}
