// Converters from the two shapes that came before `docsxai/screens-pack@2`. Both are pure: no
// file is read or written, and the result passes the v2 validator or the call throws.
//
//   - `docsxai/screens-pack@1` (one flow per capture viewport, `screens.<page>`, English alt only,
//     callouts as strings). Its files sit under the capture flow, v2 files sit under the logical
//     flow, so the result lists the file moves the caller must make.
//   - `docsxai/screens-manifest@1` (flows, steps, `{en, es}` text, `annotations` with bbox, no
//     byte sizes). Files stay where they are; the caller supplies the byte size of each.

import {
  DEFAULT_PUBLIC_PREFIX,
  HASH8_PATTERN,
  SCREENS_PACK_SCHEMA,
  fileOfSrc,
  normalisePublicPrefix,
  packFilePath,
  parseVariantKey,
  type LocalizedText,
  type PackCallout,
  type PackFlow,
  type PackStep,
  type PackVariant,
  type ScreensPack,
} from "./pack-schema.js";
import { assertValidPack } from "./pack-validate.js";

export const SCREENS_PACK_V1 = "docsxai/screens-pack@1";
export const SCREENS_MANIFEST_V1 = "docsxai/screens-manifest@1";

type Obj = Record<string, unknown>;

function obj(value: unknown, at: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object`);
  }
  return value as Obj;
}

function str(value: unknown, at: string): string {
  if (typeof value !== "string") throw new Error(`${at}: expected a string`);
  return value;
}

export interface FileMove {
  /** `<dir>/<file>` under the old pack directory. */
  from: string;
  /** `<flow>/<step>.<hash8>.png` under the new one. */
  to: string;
}

export interface ConvertPackV1Options {
  /** The logical flow every page goes under. */
  flow: string;
  /** Default `/screens`. */
  publicPrefix?: string;
}

export interface ConvertPackV1Result {
  pack: ScreensPack;
  /** Files to move so each `src` resolves. Empty when nothing changes place. */
  moves: FileMove[];
}

/** `docsxai/screens-pack@1` → v2. */
export function convertScreensPackV1(v1: unknown, opts: ConvertPackV1Options): ConvertPackV1Result {
  const root = obj(v1, "pack");
  if (root.schema !== SCREENS_PACK_V1)
    throw new Error(`pack.schema: expected "${SCREENS_PACK_V1}"`);
  const prefix = normalisePublicPrefix(opts.publicPrefix ?? DEFAULT_PUBLIC_PREFIX);
  const moves = new Map<string, FileMove>();
  const steps: Record<string, PackStep> = {};
  for (const [page, screenValue] of Object.entries(obj(root.screens, "pack.screens"))) {
    const screen = obj(screenValue, `pack.screens["${page}"]`);
    const alt = str(screen.alt, `pack.screens["${page}"].alt`);
    const variants: Record<string, PackVariant> = {};
    const locales = new Set<string>();
    for (const [key, value] of Object.entries(
      obj(screen.variants, `pack.screens["${page}"].variants`),
    )) {
      const at = `pack.screens["${page}"].variants["${key}"]`;
      const v = obj(value, at);
      const parts = parseVariantKey(key);
      const from = fileOfSrc(str(v.src, `${at}.src`));
      const hash = from?.split(".").at(-2);
      if (!parts || !from || !hash || !HASH8_PATTERN.test(hash)) {
        throw new Error(`${at}: not a <locale>.<theme>.<viewport> variant with a hash-named src`);
      }
      locales.add(parts.locale);
      const to = packFilePath(opts.flow, page, hash);
      moves.set(to, { from, to });
      const copies = Array.isArray(v.callouts) ? v.callouts : [];
      variants[key] = {
        src: `${prefix}/${to}`,
        width: v.width as number,
        height: v.height as number,
        bytes: v.bytes as number,
        callouts: copies.map((c, i): PackCallout => ({
          index: i + 1,
          copy: str(c, `${at}.callouts[${i}]`),
        })),
      };
    }
    steps[page] = { alt: Object.fromEntries([...locales].sort().map((l) => [l, alt])), variants };
  }
  const pack: ScreensPack = { schema: SCREENS_PACK_SCHEMA, flows: { [opts.flow]: { steps } } };
  assertValidPack(pack, { publicPrefix: prefix });
  return {
    pack,
    moves: [...moves.values()]
      .filter((m) => m.from !== m.to)
      .sort((a, b) => (a.to < b.to ? -1 : 1)),
  };
}

export interface ConvertManifestV1Options {
  /** Size in bytes of the file a `src` names (the v1 manifest never recorded it). */
  bytesOf: (src: string) => number;
}

function localized(value: unknown, at: string): LocalizedText {
  const out: LocalizedText = {};
  for (const [locale, text] of Object.entries(obj(value, at)))
    out[locale] = str(text, `${at}.${locale}`);
  return out;
}

function convertAnnotations(value: unknown, at: string): PackCallout[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected an array`);
  return value.map((a: unknown, i): PackCallout => {
    const ann = obj(a, `${at}[${i}]`);
    const bbox = obj(ann.bbox, `${at}[${i}].bbox`);
    return {
      index: ann.index as number,
      copy: str(ann.copy, `${at}[${i}].copy`),
      bbox: {
        x: bbox.x as number,
        y: bbox.y as number,
        width: bbox.width as number,
        height: bbox.height as number,
      },
    };
  });
}

/** `docsxai/screens-manifest@1` → v2. */
export function convertScreensManifestV1(
  manifest: unknown,
  opts: ConvertManifestV1Options,
): ScreensPack {
  const root = obj(manifest, "manifest");
  if (root.schema !== SCREENS_MANIFEST_V1)
    throw new Error(`manifest.schema: expected "${SCREENS_MANIFEST_V1}"`);
  const flows: Record<string, PackFlow> = {};
  for (const [flowId, flowValue] of Object.entries(obj(root.flows, "manifest.flows"))) {
    const flow = obj(flowValue, `manifest.flows["${flowId}"]`);
    const steps: Record<string, PackStep> = {};
    for (const [stepId, stepValue] of Object.entries(
      obj(flow.steps, `manifest.flows["${flowId}"].steps`),
    )) {
      const at = `manifest.flows["${flowId}"].steps["${stepId}"]`;
      const step = obj(stepValue, at);
      const variants: Record<string, PackVariant> = {};
      for (const [key, value] of Object.entries(obj(step.variants, `${at}.variants`))) {
        const v = obj(value, `${at}.variants["${key}"]`);
        const src = str(v.src, `${at}.variants["${key}"].src`);
        variants[key] = {
          src,
          width: v.width as number,
          height: v.height as number,
          bytes: opts.bytesOf(src),
          callouts: convertAnnotations(v.annotations, `${at}.variants["${key}"].annotations`),
        };
      }
      steps[stepId] = {
        ...(step.caption !== undefined
          ? { caption: localized(step.caption, `${at}.caption`) }
          : {}),
        alt: localized(step.alt, `${at}.alt`),
        variants,
      };
    }
    flows[flowId] = {
      ...(flow.title !== undefined
        ? { title: localized(flow.title, `manifest.flows["${flowId}"].title`) }
        : {}),
      steps,
    };
  }
  const pack: ScreensPack = {
    schema: SCREENS_PACK_SCHEMA,
    ...(typeof root.generated_for === "string" && root.generated_for !== ""
      ? { generated_for: root.generated_for }
      : {}),
    flows,
  };
  assertValidPack(pack);
  return pack;
}
