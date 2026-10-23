// A tokens file as a source for the caption theme. Two shapes are read: W3C design tokens (groups
// of `{ "$value": ..., "$type": ... }` leaves, `{group.token}` aliases) and a plain map, either
// nested (`{ "color": { "accent": "#e8590c" } }`) or flat (`{ "color.accent": "#e8590c" }`). Both
// flatten to dotted paths. Each theme key reads the default path in THEME_FIELDS unless
// `burn.theme.tokens` names another; a key that is named there must exist in the file.

import {
  THEME_FIELDS,
  THEME_KEYS,
  ThemeValueError,
  type ThemeField,
  type ThemeKey,
} from "./burn-theme-fields.js";
import type { ThemeLayer } from "./burn-theme.js";

/** Dotted token path to its raw value (alias unresolved). */
export type TokenLeaves = Map<string, unknown>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const MAX_DEPTH = 16;

function walk(node: unknown, prefix: string, out: TokenLeaves, depth: number): void {
  if (depth > MAX_DEPTH)
    throw new Error(`tokens nest deeper than ${MAX_DEPTH} levels at "${prefix}"`);
  if (!isObj(node)) {
    if (prefix !== "") out.set(prefix, node);
    return;
  }
  if (Object.hasOwn(node, "$value")) {
    out.set(prefix, node["$value"]);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    walk(value, prefix === "" ? key : `${prefix}.${key}`, out, depth + 1);
  }
}

/** Every leaf of a parsed tokens document, keyed by dotted path. Throws when the document is not an object. */
export function flattenTokens(doc: unknown): TokenLeaves {
  if (!isObj(doc)) throw new Error("must be a JSON object of tokens");
  const out: TokenLeaves = new Map();
  walk(doc, "", out, 0);
  return out;
}

const ALIAS = /^\{([^{}]+)\}$/;

function deref(leaves: TokenLeaves, value: unknown, seen: string[] = []): unknown {
  const m = typeof value === "string" ? ALIAS.exec(value.trim()) : null;
  if (!m) return value;
  const target = m[1]!;
  if (seen.includes(target)) {
    throw new ThemeValueError(`alias cycle ${[...seen, target].join(" -> ")}`);
  }
  if (!leaves.has(target)) throw new ThemeValueError(`alias {${target}} is not defined`);
  return deref(leaves, leaves.get(target), [...seen, target]);
}

const DIMENSION = /^(-?\d+(?:\.\d+)?)(px|rem)?$/;

/** `14`, `"14px"`, `"0.875rem"` or `{ value: 14, unit: "px" }` as px; anything else comes back unchanged. */
function toPx(value: unknown): unknown {
  if (isObj(value)) {
    const n = value["value"];
    const unit = value["unit"] ?? "px";
    if (typeof n !== "number") return value;
    return unit === "px" ? n : unit === "rem" ? n * 16 : value;
  }
  const m = typeof value === "string" ? DIMENSION.exec(value.trim()) : null;
  if (!m) return value;
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

function toColour(value: unknown): unknown {
  return isObj(value) && typeof value["hex"] === "string" ? value["hex"] : value;
}

function shadowLayerText(leaves: TokenLeaves, layer: unknown): string {
  if (!isObj(layer)) return String(layer);
  const px = ["offsetX", "offsetY", "blur", "spread"].map((k) =>
    toPx(deref(leaves, layer[k] ?? 0)),
  );
  if (px.some((n) => typeof n !== "number")) {
    throw new ThemeValueError("a shadow layer needs numeric offsetX, offsetY, blur and spread");
  }
  const colour = toColour(deref(leaves, layer["color"]));
  return `${px.map((n) => `${String(n)}px`).join(" ")} ${String(colour)}`;
}

function toShadow(leaves: TokenLeaves, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((l) => shadowLayerText(leaves, l)).join(", ");
  return isObj(value) ? shadowLayerText(leaves, value) : value;
}

function convert(leaves: TokenLeaves, key: ThemeKey, raw: unknown): unknown {
  const value = deref(leaves, raw);
  switch (THEME_FIELDS[key].kind) {
    case "colour":
      return toColour(value);
    case "dimension":
      return toPx(value);
    case "shadow":
      return toShadow(leaves, value);
    case "text":
      return value;
  }
}

export interface TokenLayer {
  layer: ThemeLayer;
  problems: string[];
}

/**
 * The theme values a tokens file supplies. A key in `explicit` reads that path and must find it;
 * every other key reads its default path and is skipped when the file has none. A file that
 * supplies nothing at all is a problem: it is most likely the wrong file.
 */
export function tokenLayer(
  leaves: TokenLeaves,
  explicit: Partial<Record<ThemeKey, string>>,
  file: string,
): TokenLayer {
  const layer: Record<string, unknown> = {};
  const problems: string[] = [];
  let found = 0;
  for (const key of THEME_KEYS) {
    const field: ThemeField = THEME_FIELDS[key];
    const mapped = explicit[key];
    const tokenPath = mapped ?? field.token;
    if (tokenPath === undefined) continue;
    if (!leaves.has(tokenPath)) {
      if (mapped !== undefined) {
        problems.push(
          `${key}: burn.theme.tokens maps it to "${tokenPath}", but ${file} has no such token`,
        );
      }
      continue;
    }
    found++;
    try {
      layer[field.prop] = field.parse(convert(leaves, key, leaves.get(tokenPath)));
    } catch (e) {
      if (!(e instanceof ThemeValueError)) throw e;
      problems.push(`${key}: token "${tokenPath}" in ${file}: ${e.message}`);
    }
  }
  if (found === 0 && problems.length === 0) {
    const sample = THEME_KEYS.slice(0, 3).map((k) => (THEME_FIELDS[k] as ThemeField).token);
    problems.push(
      `${file} has none of the tokens burn.theme reads (${sample.join(", ")}, ...); ` +
        "check the file, or map your own paths with burn.theme.tokens",
    );
  }
  return { layer, problems };
}
