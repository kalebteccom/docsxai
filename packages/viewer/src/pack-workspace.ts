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
  readJsonObject,
  readLocalized,
  type PackSource,
  type SourceFlow,
  type SourceStep,
} from "./pack-source.js";
import { isValidId, parseVariantKey, type LocalizedText } from "./pack-schema.js";
import { MAX_PNG_BYTES, readRegularFile } from "./safe-read.js";

export const PACK_CONFIG_SCHEMA = "docsxai/pack-config@1";
export const PACK_CONFIG_FILE = "pack.json";

/** A capture flow's directory name under `docs/`, as the engine's `burn` accepts it. */
const CAPTURE_FLOW = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

type Obj = Record<string, unknown>;

export interface PackConfig {
  /** Capture flow name → where its screenshots go in the pack. */
  sources: Record<string, { flow: string; variant: string }>;
  flows: Record<
    string,
    {
      title?: LocalizedText;
      steps: Record<string, { alt: LocalizedText; caption?: LocalizedText }>;
    }
  >;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function objectAt(value: unknown, label: string): Obj {
  if (!isObj(value)) throw new Error(`${PACK_CONFIG_FILE}: ${label} must be an object`);
  return value;
}

/** Checks the shape of `pack.json`. Text rules (locales, lengths, alt coverage) are the pack validator's. */
export function parsePackConfig(raw: Obj): PackConfig {
  if (raw.schema !== PACK_CONFIG_SCHEMA) {
    throw new Error(`${PACK_CONFIG_FILE}: schema must be "${PACK_CONFIG_SCHEMA}"`);
  }
  const sources: PackConfig["sources"] = {};
  const seen = new Map<string, string>();
  for (const [name, entry] of Object.entries(objectAt(raw.sources, "sources"))) {
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
    if (typeof e.flow !== "string" || !isValidId(e.flow)) {
      throw new Error(`${PACK_CONFIG_FILE}: sources["${name}"].flow must be a flow id`);
    }
    if (typeof e.variant !== "string" || !parseVariantKey(e.variant)) {
      throw new Error(
        `${PACK_CONFIG_FILE}: sources["${name}"].variant must be <locale>.<theme>.<viewport>`,
      );
    }
    sources[name] = { flow: e.flow, variant: e.variant };
  }
  if (Object.keys(sources).length === 0) throw new Error(`${PACK_CONFIG_FILE}: sources is empty`);
  const flows: PackConfig["flows"] = {};
  for (const [id, entry] of Object.entries(objectAt(raw.flows, "flows"))) {
    const f = objectAt(entry, `flows["${id}"]`);
    const steps: PackConfig["flows"][string]["steps"] = {};
    for (const [stepId, stepEntry] of Object.entries(objectAt(f.steps, `flows["${id}"].steps`))) {
      const s = objectAt(stepEntry, `flows["${id}"].steps["${stepId}"]`);
      const where = `${PACK_CONFIG_FILE} flows["${id}"].steps["${stepId}"]`;
      steps[stepId] = {
        alt: readLocalized(s.alt, `${where}.alt`),
        ...(s.caption !== undefined
          ? { caption: readLocalized(s.caption, `${where}.caption`) }
          : {}),
      };
    }
    flows[id] = {
      steps,
      ...(f.title !== undefined
        ? { title: readLocalized(f.title, `${PACK_CONFIG_FILE} flows["${id}"].title`) }
        : {}),
    };
  }
  return { sources, flows };
}

async function annotationsOf(docsFlowDir: string): Promise<AnnotationRecord[]> {
  const file = path.join(docsFlowDir, "annotations.json");
  const parsed = await readJsonObject(file, true);
  if (parsed.annotations === undefined) return [];
  if (!Array.isArray(parsed.annotations)) throw new Error(`${file}: annotations must be an array`);
  return (parsed.annotations as unknown[]).filter(isObj) as unknown as AnnotationRecord[];
}

/** Collects the capture flow's screenshots into the logical flow they feed. */
async function addSource(
  config: PackConfig,
  docsDir: string,
  name: string,
  into: Map<string, Map<string, SourceStep>>,
): Promise<void> {
  const { flow, variant } = config.sources[name]!;
  const flowDir = path.join(docsDir, name);
  const shots = (await fs.readdir(path.join(flowDir, "screenshots")).catch(() => [] as string[]))
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (shots.length === 0)
    throw new Error(`no screenshots under ${path.join(flowDir, "screenshots")}`);
  const records = await annotationsOf(flowDir);
  const steps = into.get(flow) ?? new Map<string, SourceStep>();
  into.set(flow, steps);
  for (const file of shots) {
    const id = file.replace(/\.png$/, "");
    const text = config.flows[flow]?.steps[id];
    if (!text)
      throw new Error(
        `${PACK_CONFIG_FILE} has no flows["${flow}"].steps["${id}"] (screenshot ${name}/${file})`,
      );
    const step = steps.get(id) ?? { id, ...text, variants: [] };
    if (step.variants.some((v) => v.key === variant)) {
      throw new Error(`${PACK_CONFIG_FILE}: two sources feed ${flow}/${id}/${variant}`);
    }
    const annotations = records.filter((r) => r.step === id);
    step.variants.push({
      key: variant,
      png: await readRegularFile(path.join(flowDir, "screenshots", file), MAX_PNG_BYTES),
      annotations,
      callouts: calloutsOf(annotations),
    });
    steps.set(id, step);
  }
}

/** Reads `<workspace>/pack.json` and the screenshots it points at. */
export async function readWorkspace(workspace: string): Promise<PackSource> {
  const config = parsePackConfig(await readJsonObject(path.join(workspace, PACK_CONFIG_FILE)));
  const docsDir = path.join(workspace, "docs");
  const into = new Map<string, Map<string, SourceStep>>();
  for (const name of Object.keys(config.sources).sort())
    await addSource(config, docsDir, name, into);
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
