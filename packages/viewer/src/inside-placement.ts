// Callout placement inside a large target, for the burner.
//
// A target that fills most of the screenshot (a panel, a list, a whole form) leaves no free spot
// beside it, and a callout on its edge covers the page anyway. `placement.inside` puts the callout
// within the target's own box instead, with no arrow: the halo already frames the target, and the
// callout reads as its caption. The planner scores positions on a grid against the same boxes the
// outside planner uses (obstacles, other halos, badges, callouts already placed) and keeps the
// cheapest. Pure and deterministic: positions are enumerated in a fixed order and replace the best
// only on a strictly lower cost.

import { scorePlacement } from "./obstacle-placement.js";
import type { Rect, Side } from "./placement.js";

/** Gap kept between the target's edge and an inside callout (halo border and glow need ~5 px). */
export const INSIDE_MARGIN = 8;
/** An inside callout is never narrower than this; a target that cannot hold it gets the outside placement. */
export const MIN_INSIDE_WIDTH = 120;
const GRID_STEP = 8;
/** Candidate positions per axis stay at or under this, so a page-sized target stays cheap. */
const MAX_STEPS_PER_AXIS = 40;
const TRAVEL_COST = 0.5; // per px (L1) the callout leaves its resting spot

type Size = { width: number; height: number };
type Align = "start" | "center" | "end";
const FRACTION = { start: 0, center: 0.5, end: 1 } as const;

export interface InsideInput {
  image: Size;
  target: Rect;
  callout: Size;
  /** Boxes of content inside the target the callout should not cover. */
  obstacles: Rect[];
  /** Other halos, badges and callouts already placed. */
  avoid?: Rect[];
  /** Offset added to the resting spot (the annotation's `nudge`); there is no arrow to leave behind. */
  nudge?: { x: number; y: number };
  /** Side of the target the callout rests against: `top` is the top edge, and so on. Default `top`. */
  side?: Side;
  /** Position along that edge. Default `center`. */
  align?: Align;
}

export interface InsidePlacement {
  /** Top-left of the callout, in image coords, nudge included. */
  callout: { x: number; y: number };
  /** Pixels of the callout still covering an obstacle or avoided box (0 = clear). */
  overlap: number;
}

/** True when the callout fits inside the target with {@link INSIDE_MARGIN} on every side. */
export function fitsInside(target: Rect, callout: Size): boolean {
  return (
    callout.width + 2 * INSIDE_MARGIN <= target.width &&
    callout.height + 2 * INSIDE_MARGIN <= target.height
  );
}

/** Range of top-left coordinates along one axis: inside the target's margin and inside the image. */
function axisRange(from: number, length: number, size: number, limit: number) {
  const lo = Math.max(from + INSIDE_MARGIN, 0);
  const hi = Math.min(from + length - INSIDE_MARGIN - size, limit - size);
  return { lo, hi };
}

/** Grid positions along one axis, nearest `rest` first. */
function positions(lo: number, hi: number, rest: number): number[] {
  const step = Math.max(GRID_STEP, Math.ceil((hi - lo) / MAX_STEPS_PER_AXIS));
  const at = new Set<number>([lo, hi, rest]);
  for (let v = lo + step; v < hi; v += step) at.add(v);
  return [...at].sort((a, b) => Math.abs(a - rest) - Math.abs(b - rest) || a - b);
}

/**
 * Cheapest callout position inside `target`, or `null` when the callout cannot be placed inside
 * the target and the image at once. Ties go to the position nearest the resting spot (the preferred
 * side's edge, aligned), then the row nearest it, then the column nearest it.
 */
export function planInside(inp: InsideInput): InsidePlacement | null {
  const { target: t, callout: c, image } = inp;
  const nudge = inp.nudge ?? { x: 0, y: 0 };
  const x = axisRange(t.x, t.width, c.width, image.width);
  const y = axisRange(t.y, t.height, c.height, image.height);
  if (x.lo > x.hi || y.lo > y.hi) return null;

  const side = inp.side ?? "top";
  const along = FRACTION[inp.align ?? "center"];
  const fx = side === "left" ? 0 : side === "right" ? 1 : along;
  const fy = side === "top" ? 0 : side === "bottom" ? 1 : along;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const restX = clamp(x.lo + (x.hi - x.lo) * fx + nudge.x, x.lo, x.hi);
  const restY = clamp(y.lo + (y.hi - y.lo) * fy + nudge.y, y.lo, y.hi);

  const ctx = { image, obstacles: inp.obstacles, avoid: inp.avoid ?? [] };
  let best: { x: number; y: number; cost: number; overlap: number } | undefined;
  for (const py of positions(y.lo, y.hi, restY)) {
    for (const px of positions(x.lo, x.hi, restX)) {
      const rect = { x: px, y: py, ...c };
      const { cost, overlap } = scorePlacement({ callout: rect, connector: [] }, ctx);
      const total = cost + Math.round((Math.abs(px - restX) + Math.abs(py - restY)) * TRAVEL_COST);
      if (best === undefined || total < best.cost) best = { x: px, y: py, cost: total, overlap };
    }
  }
  return best ? { callout: { x: best.x, y: best.y }, overlap: best.overlap } : null;
}
