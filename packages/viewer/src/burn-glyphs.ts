// Caption characters no font of the burn has a glyph for. resvg draws them as empty boxes, so the
// burner finds them first: a warning naming the annotation and the script, `missing_glyphs` in the
// report entry, and `burn --strict-glyphs` exits 1. The metrics checked are the whole font chain
// (burn-fonts.ts), so a script a fallback covers passes.

import type { AnnotationRecord } from "./annotations.js";
import type { FlowBurnReport } from "./burn-report.js";
import type { FontMetrics } from "./font-metrics.js";

/** Scripts a caption may be written in that a Latin font often lacks, in the order they are tried. */
const SCRIPTS = [
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Arabic",
  "Hebrew",
  "Thai",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Gujarati",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Sinhala",
  "Khmer",
  "Lao",
  "Myanmar",
  "Tibetan",
  "Georgian",
  "Armenian",
  "Ethiopic",
  "Syriac",
  "Thaana",
  "Cyrillic",
  "Greek",
  "Latin",
].map((name) => ({ name, test: new RegExp(`^\\p{Script=${name}}$`, "u") }));

/** Spaces, controls, joiners and variation selectors: nothing a font needs a glyph for. */
const INVISIBLE = /^[\p{White_Space}\p{Cc}\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]$/u;
const EMOJI = /^\p{Extended_Pictographic}$/u;

function scriptOf(ch: string): string {
  if (EMOJI.test(ch)) return "Emoji";
  return SCRIPTS.find((s) => s.test.test(ch))?.name ?? "Symbols";
}

export interface MissingGlyphs {
  /** Unicode script names of the missing characters (`Han`, `Arabic`, `Emoji`, `Symbols`), first seen first. */
  scripts: string[];
  /** The missing characters, each once, first seen first. */
  characters: string[];
}

/** Characters of `text` the font has no glyph for; they would draw as empty boxes. */
export function missingGlyphs(text: string, metrics: FontMetrics): MissingGlyphs {
  const characters = new Set<string>();
  const scripts = new Set<string>();
  if (metrics.hasGlyph) {
    for (const ch of text) {
      if (characters.has(ch) || INVISIBLE.test(ch) || metrics.hasGlyph(ch.codePointAt(0)!))
        continue;
      characters.add(ch);
      scripts.add(scriptOf(ch));
    }
  }
  return { scripts: [...scripts], characters: [...characters] };
}

/**
 * Warns when a drawn caption has characters the font can't draw. Returns what the report entry
 * adds: `missing_glyphs` with their scripts, or nothing.
 */
export function glyphReport(
  ann: AnnotationRecord,
  metrics: FontMetrics,
  warn: (message: string) => void,
): { missing_glyphs?: string[] } {
  const { scripts, characters } = missingGlyphs(ann.copy ?? "", metrics);
  if (scripts.length === 0) return {};
  const sample = characters.slice(0, 4).join(" ");
  warn(
    `burn: annotation "${ann.selector}" on step "${ann.step}": the caption has ${scripts.join(", ")} characters the font can't draw (${sample}), so they burn as empty boxes. Add a font that covers them to burn.theme.font_fallback`,
  );
  return { missing_glyphs: scripts };
}

/** What `burn --strict-glyphs` prints before it exits 1; null when every caption is covered. */
export function strictGlyphsNote(reports: FlowBurnReport[]): string | null {
  const n = reports.flatMap((r) => r.annotations).filter((a) => a.missing_glyphs).length;
  if (n === 0) return null;
  const captions = n === 1 ? "1 caption has" : `${n} captions have`;
  return `${captions} characters the font can't draw (--strict-glyphs). Add a font that covers them to burn.theme.font_fallback, or rewrite the copy`;
}
