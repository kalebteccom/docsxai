// The `burn.theme` block of `.docsxai.json`: checked key by key, then layered into one BurnTheme.
//
//   default look  <  preset  <  tokens file  <  keys written in the block
//
// Every problem in a block is collected and reported together, each naming the key and what to
// write instead. Pure: the tokens file is read by burn-theme-load.ts and handed in flattened.

import * as path from "node:path";
import {
  DEFAULT_BURN_THEME,
  THEME_PRESET_NAMES,
  THEME_PRESETS,
  type BurnTheme,
  type ThemeLayer,
  type ThemePresetName,
} from "./burn-theme.js";
import {
  THEME_FIELDS,
  THEME_KEYS,
  ThemeValueError,
  parseField,
  type ThemeField,
  type ThemeKey,
} from "./burn-theme-fields.js";
import { tokenLayer, type TokenLeaves } from "./burn-theme-tokens.js";

/** A `burn.theme` block that cannot be used. `message` lists every problem. */
export class BurnThemeError extends Error {
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(
      problems.length === 1
        ? `${source}: ${problems[0]}`
        : `${source} has ${problems.length} problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "BurnThemeError";
  }
}

/** A block after its keys were checked; nothing is layered yet. */
export interface ThemeConfig {
  preset?: ThemePresetName;
  /** Tokens file, relative to the workspace. */
  from?: string;
  /** Theme key to token path, for keys that read a path other than the default and must find it. */
  tokens: Partial<Record<ThemeKey, string>>;
  /** Keys written in the block itself. */
  inline: ThemeLayer;
}

const TOP_KEYS = ["preset", "from", "tokens", ...THEME_KEYS];
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length]!;
}

/** ` (did you mean "x"?)` for a near miss or a camelCase / kebab-case spelling of a known key. */
function suggestion(key: string, known: readonly string[]): string {
  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/-/g, "_");
  const near = known.find((k) => k === snake) ?? known.find((k) => distance(key, k) <= 2);
  return near === undefined ? "" : ` (did you mean "${near}"?)`;
}

function parseFrom(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ThemeValueError('must be the path of a tokens file, for example "tokens.json"');
  }
  const file = value.trim();
  if (!/\.json$/i.test(file)) throw new ThemeValueError(`"${file}" is not a .json file`);
  if (path.isAbsolute(file)) {
    throw new ThemeValueError(
      `"${file}" must be a path inside the workspace, relative to its root`,
    );
  }
  return file;
}

function parseMapping(value: unknown, problems: string[]): ThemeConfig["tokens"] {
  const mapping: Partial<Record<ThemeKey, string>> = {};
  if (!isObj(value)) {
    problems.push(
      'tokens: must be an object of theme key to token path, for example { "accent": "brand.primary" }',
    );
    return mapping;
  }
  for (const [key, tokenPath] of Object.entries(value)) {
    if (!(THEME_KEYS as string[]).includes(key)) {
      problems.push(
        `tokens.${key}: not a theme key${suggestion(key, THEME_KEYS)}; keys are ${THEME_KEYS.join(", ")}`,
      );
    } else if (typeof tokenPath !== "string" || tokenPath.trim() === "") {
      problems.push(`tokens.${key}: must be a token path such as "brand.primary"`);
    } else mapping[key as ThemeKey] = tokenPath.trim();
  }
  return mapping;
}

/** Checks the keys and values of a `burn.theme` block. Throws BurnThemeError listing every problem. */
export function parseThemeConfig(raw: unknown, source = "burn.theme"): ThemeConfig {
  if (!isObj(raw)) {
    throw new BurnThemeError(source, ['must be an object, for example { "preset": "clean" }']);
  }
  const problems: string[] = [];
  const config: ThemeConfig = { tokens: {}, inline: {} };
  for (const [key, value] of Object.entries(raw)) {
    try {
      if (key === "preset") {
        if (!(THEME_PRESET_NAMES as readonly unknown[]).includes(value)) {
          throw new ThemeValueError(
            `${JSON.stringify(value)} is not a preset; use one of ${THEME_PRESET_NAMES.join(", ")}`,
          );
        }
        config.preset = value as ThemePresetName;
      } else if (key === "from") config.from = parseFrom(value);
      else if (key === "tokens") config.tokens = parseMapping(value, problems);
      else if ((THEME_KEYS as string[]).includes(key)) {
        const field: ThemeField = THEME_FIELDS[key as ThemeKey];
        Object.assign(config.inline, parseField(field, value));
      } else {
        throw new ThemeValueError(
          `not a known key${suggestion(key, TOP_KEYS)}; keys are ${TOP_KEYS.join(", ")}`,
        );
      }
    } catch (e) {
      if (!(e instanceof ThemeValueError)) throw e;
      problems.push(`${key}${e.subkey}: ${e.message}`);
    }
  }
  if (problems.length > 0) throw new BurnThemeError(source, problems);
  return config;
}

export interface ResolveContext {
  /** Workspace root; a font path resolves under it and may not leave it. */
  workspace: string;
  /** The flattened tokens file. Required when the block has `from`. */
  tokens?: TokenLeaves;
}

/** Absolute path of `relative` under `workspace`; null when it leaves the workspace. */
export function workspaceFile(workspace: string, relative: string): string | null {
  const root = path.resolve(workspace);
  const file = path.resolve(root, relative);
  return file.startsWith(root + path.sep) ? file : null;
}

/** The theme a block describes. Throws BurnThemeError listing every problem. */
export function resolveBurnTheme(
  config: ThemeConfig,
  ctx: ResolveContext,
  source = "burn.theme",
): BurnTheme {
  const problems: string[] = [];
  const preset: ThemeLayer = config.preset ? THEME_PRESETS[config.preset] : {};
  let tokens: ThemeLayer = {};
  if (config.from !== undefined) {
    if (!ctx.tokens)
      throw new Error("resolveBurnTheme: the block has `from` but no tokens were loaded");
    const read = tokenLayer(ctx.tokens, config.tokens, config.from);
    tokens = read.layer;
    problems.push(...read.problems);
  } else if (Object.keys(config.tokens).length > 0) {
    problems.push('tokens: maps theme keys to a tokens file, so "from" must name that file');
  }
  const merged: BurnTheme = { ...DEFAULT_BURN_THEME, ...preset, ...tokens, ...config.inline };
  // The outline follows the text colour unless the preset, the tokens or the block set it.
  const border = [config.inline, tokens, preset].find((l) => l.calloutBorderColor !== undefined);
  merged.calloutBorderColor = border?.calloutBorderColor ?? merged.ink;
  if (merged.lineHeight < merged.fontSize) {
    problems.push(
      `line_height: ${merged.lineHeight} is smaller than font_size ${merged.fontSize}; lines would overlap`,
    );
  }
  if (merged.fontFile !== null) {
    const file = workspaceFile(ctx.workspace, merged.fontFile);
    if (file === null) problems.push(`font: "${merged.fontFile}" is outside the workspace`);
    else merged.fontFile = file;
  }
  if (problems.length > 0) throw new BurnThemeError(source, problems);
  return merged;
}
