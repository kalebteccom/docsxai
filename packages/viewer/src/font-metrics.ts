// Minimal TrueType metrics reader: unitsPerEm (head), advance widths (hhea + hmtx), and a
// code-point → glyph mapping (cmap formats 4 and 12). Enough to measure and wrap single-style
// text deterministically without a DOM — the burner's stand-in for the interactive overlay's
// body-attached measuring probe. Advance-width sums ignore kerning/ligatures, which only ever
// shorten a shaped line, so a box sized from these metrics never clips the rendered text.

export interface FontMetrics {
  unitsPerEm: number;
  /** Advance width in font units for a code point (the .notdef advance for unmapped ones). */
  advanceWidth(codePoint: number): number;
}

function tableDirectory(view: DataView): Map<string, number> {
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    );
    tables.set(tag, view.getUint32(base + 8));
  }
  return tables;
}

function requireTable(tables: Map<string, number>, tag: string): number {
  const offset = tables.get(tag);
  if (offset === undefined) throw new Error(`font is missing the ${tag} table`);
  return offset;
}

type GlyphLookup = (codePoint: number) => number;

function cmapFormat4(view: DataView, sub: number): GlyphLookup {
  const segCount = view.getUint16(sub + 6) / 2;
  const endCodes = sub + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let seg = 0; seg < segCount; seg++) {
      if (view.getUint16(endCodes + seg * 2) < cp) continue;
      const start = view.getUint16(startCodes + seg * 2);
      if (start > cp) return 0;
      const rangeOffset = view.getUint16(idRangeOffsets + seg * 2);
      const delta = view.getInt16(idDeltas + seg * 2);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const glyphAddr = idRangeOffsets + seg * 2 + rangeOffset + (cp - start) * 2;
      const glyph = view.getUint16(glyphAddr);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function cmapFormat12(view: DataView, sub: number): GlyphLookup {
  const nGroups = view.getUint32(sub + 12);
  return (cp) => {
    let lo = 0;
    let hi = nGroups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const base = sub + 16 + mid * 12;
      const start = view.getUint32(base);
      const end = view.getUint32(base + 4);
      if (cp < start) hi = mid - 1;
      else if (cp > end) lo = mid + 1;
      else return view.getUint32(base + 8) + (cp - start);
    }
    return 0;
  };
}

function glyphLookup(view: DataView, cmapOffset: number): GlyphLookup {
  const numSubtables = view.getUint16(cmapOffset + 2);
  let format4: number | undefined;
  let format12: number | undefined;
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platformId = view.getUint16(rec);
    const sub = cmapOffset + view.getUint32(rec + 4);
    const format = view.getUint16(sub);
    const unicode = platformId === 0 || platformId === 3;
    if (!unicode) continue;
    if (format === 12) format12 = sub;
    else if (format === 4) format4 = sub;
  }
  if (format12 !== undefined) return cmapFormat12(view, format12);
  if (format4 !== undefined) return cmapFormat4(view, format4);
  throw new Error("font has no unicode cmap subtable (format 4 or 12)");
}

export function parseFontMetrics(data: Uint8Array): FontMetrics {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tables = tableDirectory(view);
  const unitsPerEm = view.getUint16(requireTable(tables, "head") + 18);
  const numberOfHMetrics = view.getUint16(requireTable(tables, "hhea") + 34);
  const hmtx = requireTable(tables, "hmtx");
  const toGlyph = glyphLookup(view, requireTable(tables, "cmap"));
  const advanceOfGlyph = (glyph: number): number =>
    view.getUint16(hmtx + Math.min(glyph, numberOfHMetrics - 1) * 4);
  return {
    unitsPerEm,
    advanceWidth: (codePoint) => advanceOfGlyph(toGlyph(codePoint)),
  };
}

/** Width of `text` in px at `fontSize` (sum of advance widths; no kerning). */
export function measureText(text: string, fontSize: number, metrics: FontMetrics): number {
  let units = 0;
  for (const ch of text) units += metrics.advanceWidth(ch.codePointAt(0)!);
  return (units * fontSize) / metrics.unitsPerEm;
}

/**
 * Greedy word wrap to `maxWidth` px; words wider than the line are hard-broken by code point
 * (the burner's analog of the overlay CSS `overflow-wrap: anywhere`). Whitespace collapses.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  metrics: FontMetrics,
): string[] {
  const fits = (s: string) => measureText(s, fontSize, metrics) <= maxWidth;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (fits(word)) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (chunk && !fits(chunk + ch)) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}
