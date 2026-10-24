// The keys of a `burn.theme` block: how each value is checked, which `BurnTheme` property it sets
// and which token of a tokens file it reads by default. One table feeds the config parser and the
// tokens mapping, so a value from either source goes through the same checks.

import * as path from "node:path";
import { normaliseHex } from "./color.js";
import {
  AUTO_SCALE_MAX,
  BADGE_SHAPES,
  FONT_WEIGHTS,
  NARROW_BELOW_DEFAULT,
  type BurnTheme,
  type ThemeLayer,
} from "./burn-theme.js";

/**
 * A value the theme refuses. The message completes "<key><subkey>: ...", where `subkey` (such as
 * `.narrow`) names the part of an object value that is wrong.
 */
export class ThemeValueError extends Error {
  constructor(
    message: string,
    readonly subkey = "",
  ) {
    super(message);
  }
}

export type TokenKind = "colour" | "dimension" | "shadow" | "text";

export interface ThemeField {
  prop: keyof BurnTheme;
  /**
   * Default token path in a tokens file (dotted). Absent for a setting with no design-token
   * meaning (a render choice such as `scale`): a tokens file reaches it only through an explicit
   * `burn.theme.tokens` mapping.
   */
  token?: string;
  kind: TokenKind;
  parse(value: unknown): unknown;
  /**
   * The theme values a parsed value sets, when it sets more than `prop` (`display_width` also
   * sets the narrow width and its threshold). Defaults to `{ [prop]: parsed }`.
   */
  layer?(parsed: unknown): ThemeLayer;
}

/** Parses `value` with `field` and returns the theme values it sets. Throws ThemeValueError. */
export function parseField(field: ThemeField, value: unknown): ThemeLayer {
  const parsed = field.parse(value);
  return field.layer ? field.layer(parsed) : ({ [field.prop]: parsed } as ThemeLayer);
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

/** 400 or 600, as a number or the same digits in a string (a tokens file may write either). */
function fontWeight(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (n === 400 || n === 600) return n;
  throw new ThemeValueError(
    `${shown(value)} is not a supported weight; use ${FONT_WEIGHTS.join(" or ")} (the font file decides which weights exist)`,
  );
}

/** A share of the screenshot's width, 0.2 to 1. */
function widthRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ThemeValueError(`${shown(value)} is not a number; write a share such as 0.62`);
  }
  if (value < 0.2 || value > 1) throw new ThemeValueError(`${value} is outside the range 0.2 to 1`);
  return value;
}

const SCALE_RANGE = { min: 0.5, max: 4 };

/** A factor from 0.5 to 4, or `"auto"`. */
function scale(value: unknown): number | "auto" {
  if (value === "auto") return "auto";
  const n =
    typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ThemeValueError(
      `${shown(value)} is not a scale; write a number such as 1.5, or "auto" (at most ${AUTO_SCALE_MAX} then)`,
    );
  }
  if (n < SCALE_RANGE.min || n > SCALE_RANGE.max) {
    throw new ThemeValueError(`${n} is outside the range ${SCALE_RANGE.min} to ${SCALE_RANGE.max}`);
  }
  return n;
}

const DISPLAY_WIDTH_RANGE = { min: 240, max: 2400 };
const WIDTH_SHAPE = '{ "default": 720, "narrow": 358, "narrow_below": 900 }';
const WIDTH_KEYS = ["default", "narrow", "narrow_below"];

/** The `display_width` object form after its keys were checked. `default` is absent when not written. */
export interface DisplayWidthSpec {
  default?: number;
  narrow: number;
  narrowBelow: number;
}

function positive(value: unknown, sub: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ThemeValueError(
      `${shown(value)} is not a number; write a plain number of px, without a unit`,
      sub,
    );
  }
  if (value <= 0) throw new ThemeValueError(`${value} is not a positive number`, sub);
  return value;
}

/** A number of CSS px from 240 to 2400, or `{ default, narrow, narrow_below }` for two widths picked by screenshot width. */
function displayWidth(value: unknown): number | DisplayWidthSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (typeof value !== "number") {
      throw new ThemeValueError(
        `${shown(value)} is not a number; write a plain number of px, without a unit, or an object such as ${WIDTH_SHAPE}`,
      );
    }
    return numberIn(DISPLAY_WIDTH_RANGE.min, DISPLAY_WIDTH_RANGE.max)(value);
  }
  const obj = value as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => !WIDTH_KEYS.includes(k));
  if (extra.length > 0) {
    throw new ThemeValueError(
      `unknown ${extra.length === 1 ? "key" : "keys"} ${extra.map((k) => `"${k}"`).join(", ")}; the keys are ${WIDTH_KEYS.join(", ")}`,
    );
  }
  if (obj["narrow"] === undefined) {
    throw new ThemeValueError(`needs a "narrow" width, for example ${WIDTH_SHAPE}`, ".narrow");
  }
  return {
    ...(obj["default"] === undefined ? {} : { default: positive(obj["default"], ".default") }),
    narrow: positive(obj["narrow"], ".narrow"),
    narrowBelow:
      obj["narrow_below"] === undefined
        ? NARROW_BELOW_DEFAULT
        : positive(obj["narrow_below"], ".narrow_below"),
  };
}

/** A number sets `displayWidth` alone and clears the narrow pair; an object sets all three. */
function displayWidthLayer(parsed: unknown): ThemeLayer {
  if (typeof parsed === "number") {
    return { displayWidth: parsed, displayWidthNarrow: null, narrowBelow: null };
  }
  const spec = parsed as DisplayWidthSpec;
  return {
    ...(spec.default === undefined ? {} : { displayWidth: spec.default }),
    displayWidthNarrow: spec.narrow,
    narrowBelow: spec.narrowBelow,
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
  font_weight: {
    prop: "fontWeight",
    token: "font.weight.caption",
    kind: "text",
    parse: fontWeight,
  },
  arrow_size: {
    prop: "arrowSize",
    token: "size.callout.arrow",
    kind: "dimension",
    parse: numberIn(4, 24),
  },
  max_width_ratio: {
    prop: "maxWidthRatio",
    kind: "text",
    parse: widthRatio,
  },
  scale: { prop: "scale", kind: "text", parse: scale },
  display_width: {
    prop: "displayWidth",
    kind: "dimension",
    parse: displayWidth,
    layer: displayWidthLayer,
  },
} as const satisfies Record<string, ThemeField>;

export type ThemeKey = keyof typeof THEME_FIELDS;
export const THEME_KEYS = Object.keys(THEME_FIELDS) as ThemeKey[];
