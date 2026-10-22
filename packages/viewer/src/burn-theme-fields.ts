// The keys of a `burn.theme` block: how each value is checked, which `BurnTheme` property it sets
// and which token of a tokens file it reads by default. One table feeds the config parser and the
// tokens mapping, so a value from either source goes through the same checks.

import * as path from "node:path";
import { normaliseHex } from "./color.js";
import { BADGE_SHAPES, type BurnTheme } from "./burn-theme.js";

/** A value the theme refuses. The message completes "<key> ...". */
export class ThemeValueError extends Error {}

export type TokenKind = "colour" | "dimension" | "shadow" | "text";

export interface ThemeField {
  prop: keyof BurnTheme;
  /** Default token path in a tokens file (dotted). */
  token: string;
  kind: TokenKind;
  parse(value: unknown): unknown;
}

const shown = (value: unknown): string =>
  typeof value === "string" ? `"${value}"` : String(value);

function colour(value: unknown): string {
  const hex = typeof value === "string" ? normaliseHex(value.trim()) : null;
  if (hex === null) {
    throw new ThemeValueError(`${shown(value)} is not a colour; use #rgb or #rrggbb`);
  }
  return hex;
}

function numberIn(min: number, max: number): (value: unknown) => number {
  return (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ThemeValueError(
        `${shown(value)} is not a number; write a plain number of px, without a unit`,
      );
    }
    if (value < min || value > max) {
      throw new ThemeValueError(`${value} is outside the range ${min} to ${max}`);
    }
    return value;
  };
}

function oneOf<T extends string>(allowed: readonly T[]): (value: unknown) => T {
  return (value) => {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
    throw new ThemeValueError(`${shown(value)} is not one of ${allowed.join(", ")}`);
  };
}

const FONT_FILE = /\.(?:ttf|otf)$/i;

/** A TTF or OTF path relative to the workspace. Containment is checked where the workspace is known. */
function fontPath(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ThemeValueError(`${shown(value)} is not a file path`);
  }
  const file = value.trim();
  if (!FONT_FILE.test(file)) {
    throw new ThemeValueError(`${shown(file)} is not a .ttf or .otf file`);
  }
  if (path.isAbsolute(file) || file.includes("\0")) {
    throw new ThemeValueError(
      `${shown(file)} must be a path inside the workspace, relative to its root`,
    );
  }
  return file;
}

const SHADOW_LAYERS = 3;
const LENGTH = /^(-?\d+(?:\.\d+)?)(?:px)?$/;
const RGB =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/;

/** Splits on `sep` outside parentheses. */
function splitOutside(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

function shadowColour(text: string): string {
  const hex = normaliseHex(text);
  if (hex !== null) return hex;
  const m = RGB.exec(text);
  const channels = m ? [m[1], m[2], m[3]].map(Number) : [];
  if (!m || channels.some((c) => c > 255)) {
    throw new ThemeValueError(`shadow colour ${shown(text)} is not #rgb, #rrggbb, rgb() or rgba()`);
  }
  return m[4] === undefined
    ? `rgb(${channels.join(",")})`
    : `rgba(${channels.join(",")},${Number(m[4])})`;
}

function shadowLength(text: string, name: string, min: number, max: number): number {
  const m = LENGTH.exec(text);
  const value = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ThemeValueError(
      `shadow ${name} ${shown(text)} must be a px length from ${min} to ${max}`,
    );
  }
  return value;
}

function shadowLayer(layer: string): string {
  const words = splitOutside(layer.trim(), " ").filter((w) => w !== "");
  const last = words.pop();
  if (last === undefined || words.length < 2 || words.length > 4) {
    throw new ThemeValueError(
      `shadow layer ${shown(layer.trim())} must be "<x> <y> [<blur> [<spread>]] <colour>"`,
    );
  }
  const [x, y, blur = "0", spread = "0"] = words as [string, string, string?, string?];
  return [
    shadowLength(x, "x offset", -64, 64),
    shadowLength(y, "y offset", -64, 64),
    shadowLength(blur, "blur", 0, 64),
    shadowLength(spread, "spread", -32, 32),
  ]
    .map((n) => `${n}px`)
    .concat(shadowColour(last))
    .join(" ");
}

/** A CSS `box-shadow` of up to three layers, or `none`. Returns the canonical text, null for none. */
export function parseShadow(value: unknown): string | null {
  if (typeof value !== "string") {
    throw new ThemeValueError(`${shown(value)} is not a shadow; write a CSS box-shadow or "none"`);
  }
  const text = value.trim();
  if (text === "" || text.toLowerCase() === "none") return null;
  const layers = splitOutside(text, ",");
  if (layers.length > SHADOW_LAYERS) {
    throw new ThemeValueError(
      `${layers.length} shadow layers; at most ${SHADOW_LAYERS} are allowed`,
    );
  }
  return layers.map(shadowLayer).join(", ");
}

/** Config key to field. Order is the order the docs list them. */
export const THEME_FIELDS = {
  accent: { prop: "accent", token: "color.accent", kind: "colour", parse: colour },
  ink: { prop: "ink", token: "color.ink", kind: "colour", parse: colour },
  callout_background: {
    prop: "calloutBackground",
    token: "color.callout.background",
    kind: "colour",
    parse: colour,
  },
  callout_border_color: {
    prop: "calloutBorderColor",
    token: "color.callout.border",
    kind: "colour",
    parse: colour,
  },
  callout_border_width: {
    prop: "calloutBorderWidth",
    token: "border.callout.width",
    kind: "dimension",
    parse: numberIn(0, 6),
  },
  radius: { prop: "radius", token: "radius.callout", kind: "dimension", parse: numberIn(0, 24) },
  shadow: { prop: "shadow", token: "shadow.callout", kind: "shadow", parse: parseShadow },
  badge_shape: {
    prop: "badgeShape",
    token: "shape.badge",
    kind: "text",
    parse: oneOf(BADGE_SHAPES),
  },
  badge_fill: { prop: "badgeFill", token: "color.badge.background", kind: "colour", parse: colour },
  font_size: {
    prop: "fontSize",
    token: "font.size.caption",
    kind: "dimension",
    parse: numberIn(8, 32),
  },
  line_height: {
    prop: "lineHeight",
    token: "font.line-height.caption",
    kind: "dimension",
    parse: numberIn(8, 64),
  },
  padding_x: {
    prop: "paddingX",
    token: "space.callout.x",
    kind: "dimension",
    parse: numberIn(0, 40),
  },
  padding_y: {
    prop: "paddingY",
    token: "space.callout.y",
    kind: "dimension",
    parse: numberIn(0, 40),
  },
  font: { prop: "fontFile", token: "font.file", kind: "text", parse: fontPath },
} as const satisfies Record<string, ThemeField>;

export type ThemeKey = keyof typeof THEME_FIELDS;
export const THEME_KEYS = Object.keys(THEME_FIELDS) as ThemeKey[];
