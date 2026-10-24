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
  /** Cell edge in px: {@link TEXT_CELL} times the capture's pixel ratio. */
  cell: number;
  /** Device pixels per CSS pixel the cells were cut at. */
  pr: number;
  cols: number;
  rows: number;
  busy: Uint8Array;
}

/**
 * The busy cells of the whole image. Cells cut off at the right or bottom edge are left out. On a
 * `pr` times capture (device pixels per CSS pixel) the cell and the edge counts grow by `pr`, so a
 * 2x capture finds the same text boxes as its 1x twin.
 */
export function busyCells(grid: PixelGrid, pr = 1): BusyCells {
  const cell = TEXT_CELL * pr;
  const cols = Math.floor(grid.width / cell);
  const rows = Math.floor(grid.height / cell);
  const busy = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) busy[cy * cols + cx] = isBusy(grid, cx, cy, cell, pr) ? 1 : 0;
  }
  return { cell, pr, cols, rows, busy };
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
      const size = cells.cell;
      const cell = { x: cx * size, y: cy * size, width: size, height: size };
      const busy =
        cx < cells.cols &&
        cells.busy[cy * cells.cols + cx] === 1 &&
        overlapArea(cell, exclude) === 0;
      if (busy && start < 0) start = cx;
      if (!busy && start >= 0) {
        runs.push({
          x: start * cells.cell,
          y: cy * cells.cell,
          width: (cx - start) * cells.cell,
          height: cells.cell,
        });
        start = -1;
      }
    }
  }
  return mergeRows(runs).map((b) => ({
    x: b.x - TEXT_PAD_X * cells.pr,
    y: b.y - TEXT_PAD_Y * cells.pr,
    width: b.width + 2 * TEXT_PAD_X * cells.pr,
    height: b.height + 2 * TEXT_PAD_Y * cells.pr,
  }));
}

/** True when any busy cell touches `box` (image px): something is drawn there. */
export function showsText(cells: BusyCells, box: Rect): boolean {
  const size = cells.cell;
  const x0 = Math.max(0, Math.floor(box.x / size));
  const y0 = Math.max(0, Math.floor(box.y / size));
  const x1 = Math.min(cells.cols, Math.ceil((box.x + box.width) / size));
  const y1 = Math.min(cells.rows, Math.ceil((box.y + box.height) / size));
  for (let cy = y0; cy < y1; cy++) {
    for (let cx = x0; cx < x1; cx++) if (cells.busy[cy * cells.cols + cx] === 1) return true;
  }
  return false;
}

function isBusy(grid: PixelGrid, cx: number, cy: number, cell: number, pr: number): boolean {
  let across = 0;
  let down = 0;
  for (let y = cy * cell; y < (cy + 1) * cell; y++) {
    for (let x = cx * cell; x < (cx + 1) * cell; x++) {
      const here = lumaAt(grid, x, y)!;
      const right = lumaAt(grid, x + 1, y);
      const below = lumaAt(grid, x, y + 1);
      if (right !== undefined && Math.abs(here - right) >= EDGE_STEP) across++;
      if (below !== undefined && Math.abs(here - below) >= EDGE_STEP) down++;
    }
  }
  return across >= BUSY_EACH * pr && down >= BUSY_EACH * pr && across + down >= BUSY_EDGES * pr;
}

/** Luma step between side-by-side pixels that counts as part of a divider. */
export const DIVIDER_STEP = 8;
/** Share of the image height a step must run down to make its column part of a divider. */
export const DIVIDER_SHARE = 0.9;

/**
 * Full-height vertical dividers: a column whose left neighbour differs by at least
 * {@link DIVIDER_STEP} luma on {@link DIVIDER_SHARE} of the rows is an edge, and edge columns that
 * touch merge into one box (a 1 px border has an edge at each side). A sidebar's edge is one;
 * a card border is not, it does not run the height of the page. Image px, full height.
 */
export function fullHeightDividers(grid: PixelGrid): Rect[] {
  const need = Math.ceil(grid.height * DIVIDER_SHARE);
  const edges: number[] = [];
  for (let x = 1; x < grid.width; x++) {
    let n = 0;
    for (let y = 0; y < grid.height; y++) {
      if (Math.abs(lumaAt(grid, x, y)! - lumaAt(grid, x - 1, y)!) >= DIVIDER_STEP) n++;
    }
    if (n >= need) edges.push(x);
  }
  const boxes: Rect[] = [];
  for (const x of edges) {
    const last = boxes[boxes.length - 1];
    if (last && x === last.x + last.width) last.width++;
    else boxes.push({ x, y: 0, width: 1, height: grid.height });
  }
  return boxes;
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
