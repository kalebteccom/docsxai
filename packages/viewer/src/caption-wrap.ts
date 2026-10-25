// Balanced line breaking for themed burned callouts.
//
// The greedy wrap in font-metrics.ts fills each line and leaves the rest for the next, so a label
// one word too long for a line ends on a lone word ("sesión", "enviarla"), and a Spanish label can
// end a line on a one-letter word ("va a" / "ejecutar"). Here the line count stays what the greedy
// wrap gives at the full width, and the box narrows to the smallest width that keeps that count,
// so the lines come out about even. A one-letter word and a list number ("1.") stay with the word
// after them. A word wider than the line breaks after a `/`, `-`, `_`, `.` or `:` before it breaks
// between letters, so a path splits at its separators. Pure and deterministic.

import { breakPieces, measureText, type FontMetrics } from "./font-metrics.js";

/** Characters a too-wide word may break after: paths, URLs, kebab and snake names, dotted names. */
const SOFT_BREAK = /(?<=[/\-_.:\\])/u;
/** A word that should not end a line: a single letter or digit (a, e, o, u, y, I) or a list number. */
const CLINGS = /^(?:[\p{L}\p{N}]|\d+\.)$/u;

type Fits = (s: string) => boolean;

/** Pieces of a word wider than the line: its soft-break parts packed greedily, then characters. */
export function breakWord(word: string, fits: Fits): string[] {
  const pieces: string[] = [];
  let chunk = "";
  const push = (part: string) => {
    if (chunk && fits(chunk + part)) {
      chunk += part;
      return;
    }
    if (chunk) pieces.push(chunk);
    chunk = "";
    if (fits(part)) {
      chunk = part;
      return;
    }
    for (const ch of breakPieces(part, fits)) {
      if (chunk && !fits(chunk + ch)) {
        pieces.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
  };
  for (const part of word.split(SOFT_BREAK)) push(part);
  if (chunk) pieces.push(chunk);
  return pieces;
}

/** Words of `text`, a clinging word joined to the next one with a space. */
export function wrapUnits(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const units: string[] = [];
  let carry = "";
  for (const word of words) {
    const unit = carry ? `${carry} ${word}` : word;
    if (CLINGS.test(word)) carry = unit;
    else {
      units.push(unit);
      carry = "";
    }
  }
  if (carry) units.push(carry);
  return units;
}

/** Greedy fill of `units` into lines of `maxWidth`; a joined unit that fits no line is split again. */
function fill(units: string[], fontSize: number, maxWidth: number, metrics: FontMetrics): string[] {
  const fits: Fits = (s) => measureText(s, fontSize, metrics) <= maxWidth;
  const lines: string[] = [];
  let line = "";
  const place = (unit: string) => {
    const candidate = line ? `${line} ${unit}` : unit;
    if (fits(candidate)) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = "";
    if (fits(unit)) {
      line = unit;
      return;
    }
    if (unit.includes(" ")) {
      for (const word of unit.split(" ")) place(word);
      return;
    }
    const pieces = breakWord(unit, fits);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1] ?? "";
  };
  for (const unit of units) place(unit);
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * Wraps `text` into lines no wider than `maxWidth` px, as many as the greedy fill needs at
 * `maxWidth`, each about as long as the others.
 */
export function wrapBalanced(
  text: string,
  fontSize: number,
  maxWidth: number,
  metrics: FontMetrics,
): string[] {
  const units = wrapUnits(text);
  const full = fill(units, fontSize, maxWidth, metrics);
  if (full.length <= 1) return full;
  // The line count only grows as the width shrinks, so the narrowest width that keeps it is found
  // by bisection over whole px.
  let lo = 1;
  let hi = Math.floor(maxWidth);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fill(units, fontSize, mid, metrics).length <= full.length) hi = mid;
    else lo = mid + 1;
  }
  const balanced = fill(units, fontSize, hi, metrics);
  return balanced.length === full.length ? balanced : full;
}
