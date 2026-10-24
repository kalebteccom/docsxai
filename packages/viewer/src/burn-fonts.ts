// The font chain of a burned caption: the caption font (the theme's `font`, else the bundled
// Inter), then the theme's `font_fallback` files in the order written, then the bundled Noto Sans
// Arabic, Hebrew, Thai and Devanagari faces. A character takes the first font in the chain that
// has it, for measuring here and for drawing in Satori, which tries its fonts array in order.
//
// Only the fallbacks a burn's captions need go to Satori, so a burn whose captions the caption font
// covers renders with one font, as before, and keeps its bytes. Every font is a file read from the
// package or the workspace; no system font is loaded.

import { promises as fs } from "node:fs";
import { effectiveWeight, type BurnTheme } from "./burn-theme.js";
import { loadThemeFont, readFontFile, type ThemeFont } from "./burn-theme-load.js";
import { parseFontMetrics, type FontMetrics } from "./font-metrics.js";

export interface ChainFont extends ThemeFont {
  /** Family name the font is registered under in Satori. */
  name: string;
}

/** Bundled fallback faces, in chain order. Subsetted to their script; SIL OFL 1.1. */
const BUNDLED = [
  { name: "Noto Sans Arabic", file: "noto-sans-arabic-regular.ttf" },
  { name: "Noto Sans Hebrew", file: "noto-sans-hebrew-regular.ttf" },
  { name: "Noto Sans Thai", file: "noto-sans-thai-regular.ttf" },
  { name: "Noto Sans Devanagari", file: "noto-sans-devanagari-regular.ttf" },
] as const;

/** Family name the theme's own font file is registered under in Satori. */
export const THEME_FONT_NAME = "ThemeFont";

const cache = new Map<string, Promise<ChainFont>>();

/** A font from assets/fonts, read once per process. */
function bundled(name: string, file: string): Promise<ChainFont> {
  let font = cache.get(file);
  if (!font) {
    font = fs.readFile(new URL(`../assets/fonts/${file}`, import.meta.url)).then((data) => ({
      name,
      data,
      metrics: parseFontMetrics(data),
    }));
    cache.set(file, font);
  }
  return font;
}

const bundledFallbacks = () => Promise.all(BUNDLED.map((b) => bundled(b.name, b.file)));

/** The fallback part of the chain: the theme's `font_fallback` files, then the bundled faces. */
export async function fallbackFonts(theme?: BurnTheme): Promise<ChainFont[]> {
  const own = await Promise.all(
    (theme?.fontFallback ?? []).map(async (file, i) => ({
      name: `docsxai-fallback-${i + 1}`,
      ...(await readFontFile(file, "font_fallback")),
    })),
  );
  return [...own, ...(await bundledFallbacks())];
}

const covers = (m: FontMetrics, cp: number) => m.hasGlyph?.(cp) ?? false;

/**
 * Metrics of the whole chain: a character measures with the first font that has it, scaled to
 * the caption font's units per em. Characters no font has measure as the caption font's .notdef.
 */
export function chainMetrics(primary: FontMetrics, fallbacks: FontMetrics[]): FontMetrics {
  if (fallbacks.length === 0 || !primary.hasGlyph) return primary;
  const pick = (cp: number) =>
    covers(primary, cp) ? undefined : fallbacks.find((m) => covers(m, cp));
  return {
    unitsPerEm: primary.unitsPerEm,
    advanceWidth: (cp) => {
      const m = pick(cp);
      return m
        ? (m.advanceWidth(cp) * primary.unitsPerEm) / m.unitsPerEm
        : primary.advanceWidth(cp);
    },
    hasGlyph: (cp) => covers(primary, cp) || fallbacks.some((m) => covers(m, cp)),
  };
}

/** The fallbacks `texts` draw with, in chain order: those that are first to have some character. */
export function neededFallbacks(
  texts: string[],
  primary: FontMetrics,
  fallbacks: ChainFont[],
): ChainFont[] {
  if (!primary.hasGlyph) return [];
  const used = new Set<ChainFont>();
  for (const text of texts) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (covers(primary, cp)) continue;
      const font = fallbacks.find((f) => covers(f.metrics, cp));
      if (font) used.add(font);
    }
  }
  return fallbacks.filter((f) => used.has(f));
}

/** A font as Satori takes it. */
export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 600;
  style: "normal";
}

export interface BurnFonts {
  /** Metrics of the whole chain, for measuring, wrapping and the glyph check. */
  metrics: FontMetrics;
  /** The caption font, then the fallbacks `texts` draw with, in chain order. */
  fonts: SatoriFont[];
}

/** The fonts a burn under `theme` (none: today's look) draws `texts` with. */
export async function burnFonts(theme: BurnTheme | undefined, texts: string[]): Promise<BurnFonts> {
  const own = theme ? await loadThemeFont(theme) : undefined;
  const primary = own
    ? { name: THEME_FONT_NAME, ...own }
    : await bundled("Inter", "inter-regular.ttf");
  const fallbacks = await fallbackFonts(theme);
  const weight = theme ? effectiveWeight(theme) : 400;
  return {
    metrics: chainMetrics(
      primary.metrics,
      fallbacks.map((f) => f.metrics),
    ),
    fonts: [primary, ...neededFallbacks(texts, primary.metrics, fallbacks)].map((f) => ({
      name: f.name,
      data: f.data,
      weight,
      style: "normal",
    })),
  };
}

/** Scripts written right to left. */
const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LETTER = /\p{L}/u;

/**
 * Reading direction of a caption: right to left when its first letter is Arabic, Hebrew, Syriac,
 * Thaana or N'Ko (the first strong character of the Unicode bidi algorithm), else left to right.
 */
export function captionDirection(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    if (LETTER.test(ch)) return RTL.test(ch) ? "rtl" : "ltr";
  }
  return "ltr";
}
