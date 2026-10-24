// Reads the caption theme of a workspace: the `burn.theme` block of `.docsxai.json`, the tokens
// file it names and the font file it points at. The pure parts (checks, layering) are in
// burn-theme-config.ts; this file only does the reads and says what was missing.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { contrastWarnings, weightWarnings, type BurnTheme } from "./burn-theme.js";
import {
  BurnThemeError,
  parseThemeConfig,
  resolveBurnTheme,
  workspaceFile,
} from "./burn-theme-config.js";
import { flattenTokens, type TokenLeaves } from "./burn-theme-tokens.js";
import { parseFontMetrics, type FontMetrics } from "./font-metrics.js";
import { MAX_JSON_BYTES, readRegularFile } from "./safe-read.js";

export const WORKSPACE_CONFIG_FILE = ".docsxai.json";
const SOURCE = `${WORKSPACE_CONFIG_FILE} burn.theme`;
/** Largest font file read. */
const MAX_FONT_BYTES = 16 * 1024 * 1024;
/** `sfnt` versions of TrueType (0x00010000, "true") and OpenType with CFF outlines ("OTTO"). */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

export interface ThemeFont {
  data: Buffer;
  metrics: FontMetrics;
}

/** Reads and measures a TTF or OTF the theme names under `key` (`font`, `font_fallback`). */
export async function readFontFile(file: string, key = "font"): Promise<ThemeFont> {
  let data: Buffer;
  try {
    data = await readRegularFile(file, MAX_FONT_BYTES);
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? `burn.theme ${key} ${file} does not exist`
        : `burn.theme ${key}: ${(e as Error).message}`,
    );
  }
  if (data.length < 12 || !SFNT_VERSIONS.has(data.readUInt32BE(0))) {
    throw new Error(
      `burn.theme ${key} ${file} is not a TrueType or OpenType font (collections and WOFF files are not supported)`,
    );
  }
  try {
    return { data, metrics: parseFontMetrics(data) };
  } catch (e) {
    throw new Error(`burn.theme ${key} ${file} cannot be measured: ${(e as Error).message}`);
  }
}

/** The theme's font file, read and measured; undefined when the theme uses the bundled Inter. */
export async function loadThemeFont(theme: BurnTheme): Promise<ThemeFont | undefined> {
  return theme.fontFile === null ? undefined : readFontFile(theme.fontFile);
}

async function readTokens(workspace: string, from: string): Promise<TokenLeaves> {
  const file = workspaceFile(workspace, from);
  if (file === null) throw new BurnThemeError(SOURCE, [`from: "${from}" is outside the workspace`]);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    throw new BurnThemeError(SOURCE, [
      `from: ${from} does not exist or cannot be read (looked in ${workspace})`,
    ]);
  }
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
    throw new BurnThemeError(SOURCE, [
      `from: ${from} is larger than ${MAX_JSON_BYTES / (1024 * 1024)} MiB`,
    ]);
  }
  try {
    return flattenTokens(JSON.parse(text));
  } catch (e) {
    throw new BurnThemeError(SOURCE, [`from: ${from} is not usable: ${(e as Error).message}`]);
  }
}

async function readConfig(workspace: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(workspace, WORKSPACE_CONFIG_FILE), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    throw new Error(`${WORKSPACE_CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
  }
}

export interface LoadedTheme {
  theme: BurnTheme;
  /** WCAG AA misses of the text pairs and a weight the font cannot give; the theme is used either way. */
  warnings: string[];
}

/**
 * The theme a workspace asks for, or undefined when its `.docsxai.json` has no `burn.theme`
 * (burn then draws today's look). Throws BurnThemeError for a block that cannot be used and an
 * Error for an unreadable font or a config that is not JSON.
 */
export async function loadBurnTheme(workspace: string): Promise<LoadedTheme | undefined> {
  const config = await readConfig(workspace);
  const burn = config?.["burn"];
  if (burn === undefined) return undefined;
  if (typeof burn !== "object" || burn === null || Array.isArray(burn)) {
    throw new BurnThemeError(`${WORKSPACE_CONFIG_FILE} burn`, ["must be an object holding theme"]);
  }
  const unknown = Object.keys(burn).filter((k) => k !== "theme");
  if (unknown.length > 0) {
    throw new BurnThemeError(
      `${WORKSPACE_CONFIG_FILE} burn`,
      unknown.map((k) => `${k}: not a known key; the only key is theme`),
    );
  }
  const raw = (burn as Record<string, unknown>)["theme"];
  if (raw === undefined) return undefined;
  const parsed = parseThemeConfig(raw, SOURCE);
  const tokens = parsed.from !== undefined ? await readTokens(workspace, parsed.from) : undefined;
  const theme = resolveBurnTheme(parsed, { workspace, ...(tokens ? { tokens } : {}) }, SOURCE);
  await loadThemeFont(theme);
  for (const file of theme.fontFallback ?? []) await readFontFile(file, "font_fallback");
  return { theme, warnings: [...contrastWarnings(theme), ...weightWarnings(theme)] };
}

/** {@link loadBurnTheme} for a command: contrast warnings go to `warn`, and the bare theme comes back. */
export async function workspaceTheme(
  workspace: string,
  warn: (message: string) => void,
): Promise<BurnTheme | undefined> {
  const loaded = await loadBurnTheme(workspace);
  for (const w of loaded?.warnings ?? []) warn(w);
  return loaded?.theme;
}
