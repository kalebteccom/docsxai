// The `docsxai/screens-pack@2` document: types, id patterns and canonical serialisation.
// One shape for what a docs site or README consumes: flows of steps, each step a set of
// hash-named PNG variants keyed `<locale>.<theme>.<viewport>`. Pure, no IO.

import type { BoundingBox } from "./annotations.js";

export const SCREENS_PACK_SCHEMA = "docsxai/screens-pack@2";
export const DEFAULT_PUBLIC_PREFIX = "/screens";
export const PACK_MANIFEST_FILE = "manifest.json";

/** Flow and step ids. No dots: the hash sits between two dots in `<step>.<hash8>.png`. */
export const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const ID_MAX = 64;
export const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
export const THEME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
export const VIEWPORT_PATTERN = /^[1-9][0-9]{2,3}$/;
export const HASH8_PATTERN = /^[0-9a-f]{8}$/;
const VARIANT_KEY_PATTERN = /^([^.]+)\.([^.]+)\.([^.]+)$/;

export type LocalizedText = Record<string, string>;

export interface PackCallout {
  /** 1-based, unique within the variant. */
  index: number;
  copy: string;
  /** Where the halo sits, in the PNG's pixel space. */
  bbox?: BoundingBox;
}

export interface PackVariant {
  /** `<public-prefix>/<flow>/<step>.<hash8>.png` */
  src: string;
  width: number;
  height: number;
  /** Size of the file `src` names. */
  bytes: number;
  callouts: PackCallout[];
}

export interface PackStep {
  caption?: LocalizedText;
  alt: LocalizedText;
  variants: Record<string, PackVariant>;
}

export interface PackFlow {
  title?: LocalizedText;
  steps: Record<string, PackStep>;
}

export interface ScreensPack {
  schema: typeof SCREENS_PACK_SCHEMA;
  generated_for?: string;
  flows: Record<string, PackFlow>;
}

export interface VariantKeyParts {
  locale: string;
  theme: string;
  viewport: number;
}

/** Splits `<locale>.<theme>.<viewport>`; `null` when the key is not one. */
export function parseVariantKey(key: string): VariantKeyParts | null {
  const m = VARIANT_KEY_PATTERN.exec(key);
  if (!m) return null;
  const locale = m[1]!;
  const theme = m[2]!;
  const viewport = m[3]!;
  if (!LOCALE_PATTERN.test(locale) || !THEME_PATTERN.test(theme)) return null;
  if (!VIEWPORT_PATTERN.test(viewport)) return null;
  return { locale, theme, viewport: Number(viewport) };
}

export function isValidId(id: string): boolean {
  return id.length <= ID_MAX && ID_PATTERN.test(id);
}

/** Normalises a public prefix: leading slash, no trailing slash, `""` for the site root. */
export function normalisePublicPrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const bad = rooted.split("/").find((s) => s === "." || s === ".." || /[^A-Za-z0-9._~/-]/.test(s));
  if (bad !== undefined) throw new Error(`public prefix "${prefix}" is not a plain URL path`);
  return rooted;
}

/** Relative file path (`<flow>/<step>.<hash8>.png`) for a variant. */
export function packFilePath(flow: string, step: string, hash8: string): string {
  return `${flow}/${step}.${hash8}.png`;
}

const SRC_TAIL = /([a-z0-9]+(?:[-_][a-z0-9]+)*)\/([a-z0-9]+(?:[-_][a-z0-9]+)*\.[0-9a-f]{8}\.png)$/;

/**
 * The `<flow>/<step>.<hash8>.png` tail of a `src`, whatever public prefix it carries; `null` when
 * the tail is not that shape. This is the file's place under the pack directory.
 */
export function fileOfSrc(src: string): string | null {
  const m = SRC_TAIL.exec(src);
  return m && (m.index === 0 || src[m.index - 1] === "/") ? `${m[1]}/${m[2]}` : null;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, sortDeep(record[k])]),
    );
  }
  return value;
}

/** Canonical manifest text: keys sorted at every depth, two-space indent, trailing newline. */
export function serialisePack(pack: ScreensPack): string {
  return `${JSON.stringify(sortDeep(pack), null, 2)}\n`;
}
