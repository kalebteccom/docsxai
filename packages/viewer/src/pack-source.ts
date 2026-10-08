// What `docsxai pack` builds from: flows of steps of clean screenshots with their annotations.
// This file holds the shape and the raw-capture reader:
//
//   <root>/<flow>/flow.json                              { title?: { <locale>: text } }
//   <root>/<flow>/<step>/step.json                       { alt: { <locale>: text }, caption?: { ... } }
//   <root>/<flow>/<step>/<locale>.<theme>.<viewport>.png
//   <root>/<flow>/<step>/<locale>.<theme>.<viewport>.json  { width?, height?, annotations?: [...] }
//
// The workspace reader is pack-workspace.ts. Both return a `PackSource`.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnnotationRecord } from "./annotations.js";
import { pngDimensions } from "./burn.js";
import { calloutsOf, recordsFromSidecar } from "./pack-annotations.js";
import { showingPath } from "./pack-paths.js";
import { isValidId, parseVariantKey, type LocalizedText, type PackCallout } from "./pack-schema.js";
import { MAX_JSON_BYTES, MAX_PNG_BYTES, readRegularFile } from "./safe-read.js";

export interface SourceVariant {
  key: string;
  /** The clean screenshot. */
  png: Buffer;
  annotations: AnnotationRecord[];
  callouts: PackCallout[];
}

export interface SourceStep {
  id: string;
  caption?: LocalizedText;
  alt: LocalizedText;
  variants: SourceVariant[];
}

export interface SourceFlow {
  id: string;
  title?: LocalizedText;
  steps: SourceStep[];
}

export type PackSource = SourceFlow[];

type Obj = Record<string, unknown>;

/**
 * Reads a JSON file that must hold an object. `optional`: a missing file reads as `{}`. `shown`
 * is the name messages use for the file, when the absolute path should not appear in them.
 */
export async function readJsonObject(file: string, optional = false, shown = file): Promise<Obj> {
  let text: string;
  try {
    text = (await showingPath(shown, () => readRegularFile(file, MAX_JSON_BYTES))).toString("utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (optional) return {};
    throw new Error(`missing ${shown}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the offending text; the capture is not trusted, so it is dropped.
    throw new Error(`invalid JSON in ${shown}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${shown}: expected a JSON object`);
  }
  return value as Obj;
}

/** A locale-to-text object, copied. Only the shape is checked here; the pack validator checks the rest. */
export function readLocalized(value: unknown, label: string): LocalizedText {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object of locale to text`);
  }
  const out: LocalizedText = {};
  for (const [locale, text] of Object.entries(value as Obj)) {
    if (typeof text !== "string") throw new Error(`${label}.${locale} must be a string`);
    out[locale] = text;
  }
  return out;
}

async function listDirectories(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  const bad = names.find((n) => !isValidId(n));
  if (bad !== undefined) {
    throw new Error(
      `unsupported directory name "${bad}" under ${dir} (use lowercase words joined by - or _)`,
    );
  }
  return names;
}

async function readVariant(stepDir: string, step: string, file: string): Promise<SourceVariant> {
  const key = file.replace(/\.png$/, "");
  if (!parseVariantKey(key)) {
    throw new Error(
      `${path.join(stepDir, file)}: variant file must be <locale>.<theme>.<viewport>.png`,
    );
  }
  const png = await readRegularFile(path.join(stepDir, file), MAX_PNG_BYTES);
  const size = pngDimensions(png);
  const sidecarFile = path.join(stepDir, `${key}.json`);
  const sidecar = await readJsonObject(sidecarFile, true);
  const declared = [sidecar.width, sidecar.height];
  if (
    declared.some((d) => d !== undefined) &&
    (sidecar.width !== size.width || sidecar.height !== size.height)
  ) {
    throw new Error(
      `${sidecarFile}: sidecar says ${String(declared[0])}x${String(declared[1])}, PNG is ${size.width}x${size.height}`,
    );
  }
  const annotations = recordsFromSidecar(step, sidecar.annotations, sidecarFile);
  return { key, png, annotations, callouts: calloutsOf(annotations) };
}

async function readStep(flowDir: string, flow: string, step: string): Promise<SourceStep> {
  const stepDir = path.join(flowDir, step);
  const meta = await readJsonObject(path.join(stepDir, "step.json"));
  const files = (await fs.readdir(stepDir)).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) {
    throw new Error(`step ${flow}/${step} has no <locale>.<theme>.<viewport>.png`);
  }
  const variants: SourceVariant[] = [];
  for (const file of files) variants.push(await readVariant(stepDir, step, file));
  return {
    id: step,
    ...(meta.caption !== undefined
      ? { caption: readLocalized(meta.caption, `${flow}/${step} caption`) }
      : {}),
    alt: readLocalized(meta.alt, `${flow}/${step} alt`),
    variants,
  };
}

/** Reads a raw capture directory. Throws on a missing directory, an unsafe name or a bad sidecar. */
export async function readRawCapture(root: string): Promise<PackSource> {
  let flowIds: string[];
  try {
    flowIds = await listDirectories(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`raw capture directory not found: ${root}`);
    }
    throw e;
  }
  if (flowIds.length === 0) throw new Error(`no flows found under ${root}`);
  const flows: PackSource = [];
  for (const id of flowIds) {
    const flowDir = path.join(root, id);
    const meta = await readJsonObject(path.join(flowDir, "flow.json"), true);
    const steps: SourceStep[] = [];
    for (const step of await listDirectories(flowDir))
      steps.push(await readStep(flowDir, id, step));
    flows.push({
      id,
      ...(meta.title !== undefined ? { title: readLocalized(meta.title, `${id} title`) } : {}),
      steps,
    });
  }
  return flows;
}
