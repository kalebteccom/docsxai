// Text areas estimated from a screenshot's pixels, for annotations that carry no `obstacles`. Text
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
 * Edges a cell needs to be busy. A 1 px rule across an 8 px cell gives 16 (one step on each side
 * of it); a line of 13 px text gives 30 and more.
 */
export const BUSY_EDGES = 20;

/**
 * Busy boxes within `reach` px of `around`, in image px. Cells touching `exclude` (the target, so a
 * callout may sit next to its own text) are left out. Rows of busy cells merge into runs, and runs
 * with the same span in consecutive rows merge into one box.
 */
export function textBoxes(grid: PixelGrid, around: Rect, reach: number, exclude: Rect): Rect[] {
  const x0 = Math.max(0, Math.floor((around.x - reach) / TEXT_CELL));
  const y0 = Math.max(0, Math.floor((around.y - reach) / TEXT_CELL));
  const x1 = Math.min(
    Math.floor(grid.width / TEXT_CELL),
    Math.ceil((around.x + around.width + reach) / TEXT_CELL),
  );
  const y1 = Math.min(
    Math.floor(grid.height / TEXT_CELL),
    Math.ceil((around.y + around.height + reach) / TEXT_CELL),
  );
  const runs: Rect[] = [];
  for (let cy = y0; cy < y1; cy++) {
    let start = -1;
    for (let cx = x0; cx <= x1; cx++) {
      const busy = cx < x1 && isBusy(grid, cx, cy, exclude);
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
  return mergeRows(runs);
}

function isBusy(grid: PixelGrid, cx: number, cy: number, exclude: Rect): boolean {
  const cell = { x: cx * TEXT_CELL, y: cy * TEXT_CELL, width: TEXT_CELL, height: TEXT_CELL };
  if (overlapArea(cell, exclude) > 0) return false;
  let edges = 0;
  for (let y = cell.y; y < cell.y + TEXT_CELL; y++) {
    for (let x = cell.x; x < cell.x + TEXT_CELL; x++) {
      const here = lumaAt(grid, x, y)!;
      const right = lumaAt(grid, x + 1, y);
      const below = lumaAt(grid, x, y + 1);
      if (right !== undefined && Math.abs(here - right) >= EDGE_STEP) edges++;
      if (below !== undefined && Math.abs(here - below) >= EDGE_STEP) edges++;
    }
  }
  return edges >= BUSY_EDGES;
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
