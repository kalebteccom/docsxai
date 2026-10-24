// Text areas estimated from a screenshot's pixels, added to the `obstacles` an annotation lists. Text
// is dense with sharp luminance steps; flat panels, gradients and single rules are not. The image
// is cut into square cells, a cell with enough strong steps is busy, and busy cells merge into
// boxes the obstacle planner keeps callouts off. Integer maths only, so the boxes are a pure
// function of the pixels.

import { lumaAt, type PixelGrid } from "./connector-contrast.js";
import { overlapArea } from "./obstacle-placement.js";
import type { Rect } from "./placement.js";

/** Cell edge in px. */
export const TEXT_CELL = 8;
/** Luma step between neighbours that counts as an edge. */
export const EDGE_STEP = 48;
/**
 * Edges a cell needs to be busy: at least this many in total, and at least {@link BUSY_EACH} in each
 * direction. Glyphs have steps both ways; a 1 px rule or a box edge has them one way only, so a
 * divider or a card border is not text.
 */
export const BUSY_EDGES = 12;
export const BUSY_EACH = 4;
/** Px a found text box is grown by, across and along the line: glyph edges the cells cut off. */
export const TEXT_PAD_X = 4;
export const TEXT_PAD_Y = 2;

/** Which cells of an image are busy: `busy[row * cols + col]` is 1 for a busy cell. */
export interface BusyCells {
  cols: number;
  rows: number;
  busy: Uint8Array;
}

/** The busy cells of the whole image. Cells cut off at the right or bottom edge are left out. */
export function busyCells(grid: PixelGrid): BusyCells {
  const cols = Math.floor(grid.width / TEXT_CELL);
  const rows = Math.floor(grid.height / TEXT_CELL);
  const busy = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) busy[cy * cols + cx] = isBusy(grid, cx, cy) ? 1 : 0;
  }
  return { cols, rows, busy };
}

/**
 * Busy boxes, in image px, leaving out cells that touch `exclude` (the target, so a callout may
 * sit next to its own text). Rows of busy cells merge into runs, and runs with the same span in
 * consecutive rows merge into one box.
 */
export function textBoxes(cells: BusyCells, exclude: Rect): Rect[] {
  const runs: Rect[] = [];
  for (let cy = 0; cy < cells.rows; cy++) {
    let start = -1;
    for (let cx = 0; cx <= cells.cols; cx++) {
      const cell = { x: cx * TEXT_CELL, y: cy * TEXT_CELL, width: TEXT_CELL, height: TEXT_CELL };
      const busy =
        cx < cells.cols &&
        cells.busy[cy * cells.cols + cx] === 1 &&
        overlapArea(cell, exclude) === 0;
      if (busy && start < 0) start = cx;
      if (!busy && start >= 0) {
        runs.push({
          x: start * TEXT_CELL,
          y: cy * TEXT_CELL,
          width: (cx - start) * TEXT_CELL,
          height: TEXT_CELL,
        });
        start = -1;
      }
    }
  }
  return mergeRows(runs).map((b) => ({
    x: b.x - TEXT_PAD_X,
    y: b.y - TEXT_PAD_Y,
    width: b.width + 2 * TEXT_PAD_X,
    height: b.height + 2 * TEXT_PAD_Y,
  }));
}

/** True when any busy cell touches `box` (image px): something is drawn there. */
export function showsText(cells: BusyCells, box: Rect): boolean {
  const x0 = Math.max(0, Math.floor(box.x / TEXT_CELL));
  const y0 = Math.max(0, Math.floor(box.y / TEXT_CELL));
  const x1 = Math.min(cells.cols, Math.ceil((box.x + box.width) / TEXT_CELL));
  const y1 = Math.min(cells.rows, Math.ceil((box.y + box.height) / TEXT_CELL));
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) if (cells.busy[cy * cells.cols + cx] === 1) return true;
  }
  return false;
}

function isBusy(grid: PixelGrid, cx: number, cy: number): boolean {
  let across = 0;
  let down = 0;
  for (let y = cy * TEXT_CELL; y < (cy + 1) * TEXT_CELL; y++) {
    for (let x = cx * TEXT_CELL; x < (cx + 1) * TEXT_CELL; x++) {
      const here = lumaAt(grid, x, y)!;
      const right = lumaAt(grid, x + 1, y);
      const below = lumaAt(grid, x, y + 1);
      if (right !== undefined && Math.abs(here - right) >= EDGE_STEP) across++;
      if (below !== undefined && Math.abs(here - below) >= EDGE_STEP) down++;
    }
  }
  return across >= BUSY_EACH && down >= BUSY_EACH && across + down >= BUSY_EDGES;
}

/** Runs with the same x span in consecutive rows become one box. Input is in row order. */
function mergeRows(runs: Rect[]): Rect[] {
  const open = new Map<string, Rect>();
  const done: Rect[] = [];
  for (const r of runs) {
    const key = `${r.x}:${r.width}`;
    const prev = open.get(key);
    if (prev && prev.y + prev.height === r.y) {
      prev.height += r.height;
    } else {
      if (prev) done.push(prev);
      open.set(key, { ...r });
    }
  }
  return [...done, ...open.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}
