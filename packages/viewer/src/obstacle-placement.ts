// Obstacle-aware callout placement for the burner.
//
// `placeCallout` (placement.ts) puts a callout adjacent to its target, so a narrow target beside
// text cannot slide far enough to clear it. This planner also tries callouts further out (a stem
// joins them to the arrow) and slid along the target's edge, scores every candidate by how much it
// covers, and keeps the cheapest. Pure and deterministic: candidates are enumerated in a fixed
// order and a candidate only replaces the best on a strictly better (cost, side rank, travel).

import { arrowGeometry, stemGeometry } from "./arrow.js";
import {
  placeCallout,
  type PlaceInput,
  type Placement,
  type Rect,
  type Side,
} from "./placement.js";

export interface PlanInput extends PlaceInput {
  /** Boxes of page content the callout must not cover. The target itself is not one of them. */
  obstacles: Rect[];
  /** Further boxes to keep clear: other annotations' halos and badges, callouts already placed. */
  avoid?: Rect[];
  /** Offset the renderer adds to callout + arrow after placement; candidates are scored shifted. */
  nudge?: { x: number; y: number };
}

export interface PlannedPlacement extends Placement {
  /** Gap between the target edge and the callout edge. */
  distance: number;
  /** Bar from the arrow base to the callout edge; `null` when the callout sits at the base gap. */
  stem: Rect | null;
  /** Pixels of the callout and arrow still covering an obstacle or avoided box (0 = clear). */
  overlap: number;
}

export interface ScoreContext {
  image: { width: number; height: number };
  obstacles: Rect[];
  avoid: Rect[];
}

export interface Candidate {
  callout: Rect;
  /** Arrow triangle + stem boxes. */
  connector: Rect[];
}

/** Callout may be this much closer than 0 px to an obstacle before it counts as touching. */
const CLEARANCE = 4;
/** Distances beyond the base gap that are tried, in px. */
const EXTRA_DISTANCES = [0, 12, 28, 48, 76, 112, 160, 224, 320];
const SLIDE_STEP = 8;
/** Arrow tip stays this far inside the target's ends. */
const ARROW_INSET = 6;
/** The stem leaves the callout at least this far from its corners. */
const ATTACH_MARGIN = 10;
const SIDES: readonly Side[] = ["top", "bottom", "right", "left"];

const CONTENT_WEIGHT = 10; // callout px² on page content
const CLEARANCE_WEIGHT = 1; // callout px² within CLEARANCE of page content
const AVOID_WEIGHT = 8; // callout px² on a halo, badge or earlier callout
const CONNECTOR_WEIGHT = 6; // arrow / stem px² on either
const BOUNDS_WEIGHT = 50; // callout px² outside the image
const STEM_COST = 1.5; // per px of stem
const SLIDE_COST = 0.5; // per px the callout leaves its centred spot
const SIDE_SWITCH_COST = 120; // leaving the preferred side

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  width: r.width + 2 * m,
  height: r.height + 2 * m,
});
const shift = (r: Rect, d: { x: number; y: number }): Rect => ({
  ...r,
  x: r.x + d.x,
  y: r.y + d.y,
});
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sum = (rects: Rect[], against: Rect[]) =>
  rects.reduce((s, r) => s + against.reduce((t, o) => t + overlapArea(r, o), 0), 0);

/** Cost (what the planner minimises) and raw overlap (px² still covering something) of a candidate. */
export function scorePlacement(c: Candidate, ctx: ScoreContext): { cost: number; overlap: number } {
  const padded = inflate(c.callout, CLEARANCE);
  const onContent = sum([c.callout], ctx.obstacles);
  const onAvoid = sum([c.callout], ctx.avoid);
  const connectorHits = sum(c.connector, ctx.obstacles) + sum(c.connector, ctx.avoid);
  const bounds = { x: 0, y: 0, ...ctx.image };
  const outside = c.callout.width * c.callout.height - overlapArea(c.callout, bounds);
  const cost =
    CONTENT_WEIGHT * onContent +
    CLEARANCE_WEIGHT * (sum([padded], ctx.obstacles) - onContent) +
    AVOID_WEIGHT * onAvoid +
    CONNECTOR_WEIGHT * connectorHits +
    BOUNDS_WEIGHT * outside;
  return { cost: Math.round(cost), overlap: Math.round(onContent + onAvoid + connectorHits) };
}

interface Scored extends PlannedPlacement {
  cost: number;
  rank: number;
  travel: number;
}

/** Callout start positions along the target's edge that keep a stem attachable, nearest first. */
function slideStarts(
  span: { from: number; length: number },
  calloutLength: number,
  limit: number,
): number[] {
  const inset = Math.min(ARROW_INSET, span.length / 2);
  const margin = Math.min(ATTACH_MARGIN, calloutLength / 2);
  const lo = Math.max(0, span.from + inset - calloutLength + margin);
  const hi = Math.min(limit - calloutLength, span.from + span.length - inset - margin);
  if (lo > hi) return [];
  const centred = clamp(span.from + span.length / 2 - calloutLength / 2, lo, hi);
  const starts = new Set<number>([centred, lo, hi]);
  for (let s = SLIDE_STEP; centred - s >= lo || centred + s <= hi; s += SLIDE_STEP) {
    if (centred - s >= lo) starts.add(centred - s);
    if (centred + s <= hi) starts.add(centred + s);
  }
  return [...starts].sort((a, b) => Math.abs(a - centred) - Math.abs(b - centred) || a - b);
}

function layout(side: Side, inp: PlaceInput, distance: number, start: number) {
  const { target: t, callout: c, image } = inp;
  const horizontal = side === "top" || side === "bottom";
  const from = horizontal ? t.x : t.y;
  const length = horizontal ? t.width : t.height;
  const calloutLength = horizontal ? c.width : c.height;
  const inset = Math.min(ARROW_INSET, length / 2);
  const margin = Math.min(ATTACH_MARGIN, calloutLength / 2);
  const centre = start + calloutLength / 2;
  const along = clamp(
    clamp(centre, from + inset, from + length - inset),
    start + margin,
    start + calloutLength - margin,
  );
  const limit = horizontal ? image.width : image.height;
  const tip = clamp(along, 0, limit);
  switch (side) {
    case "top":
      return { x: start, y: t.y - distance - c.height, arrow: { x: tip, y: t.y } };
    case "bottom":
      return { x: start, y: t.y + t.height + distance, arrow: { x: tip, y: t.y + t.height } };
    case "left":
      return { x: t.x - distance - c.width, y: start, arrow: { x: t.x, y: tip } };
    case "right":
      return { x: t.x + t.width + distance, y: start, arrow: { x: t.x + t.width, y: tip } };
  }
}

function* candidates(inp: PlanInput, order: Side[], gap: number): Generator<Scored> {
  const { image, target: t, callout: c } = inp;
  const nudge = inp.nudge ?? { x: 0, y: 0 };
  const ctx: ScoreContext = { image, obstacles: inp.obstacles, avoid: inp.avoid ?? [] };
  for (const [rank, side] of order.entries()) {
    const horizontal = side === "top" || side === "bottom";
    const span = horizontal ? { from: t.x, length: t.width } : { from: t.y, length: t.height };
    const starts = slideStarts(
      span,
      horizontal ? c.width : c.height,
      horizontal ? image.width : image.height,
    );
    const centred = starts[0] ?? 0;
    for (const extra of EXTRA_DISTANCES) {
      const distance = gap + extra;
      for (const start of starts) {
        const l = layout(side, inp, distance, start);
        const rect = { x: l.x, y: l.y, width: c.width, height: c.height };
        const inside =
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= image.width &&
          rect.y + rect.height <= image.height;
        if (!inside) continue;
        const a = arrowGeometry(side, l.arrow);
        const stem = extra > 0 ? stemGeometry(side, l.arrow, distance) : null;
        const connector = [
          { x: a.left, y: a.top, width: a.width, height: a.height },
          ...(stem ? [stem] : []),
        ].map((r) => shift(r, nudge));
        const { cost, overlap } = scorePlacement({ callout: shift(rect, nudge), connector }, ctx);
        const travel = extra * STEM_COST + Math.abs(start - centred) * SLIDE_COST;
        yield {
          side,
          callout: { x: rect.x, y: rect.y },
          arrow: l.arrow,
          distance,
          stem,
          overlap,
          cost: cost + Math.round(travel) + (rank === 0 ? 0 : SIDE_SWITCH_COST),
          rank,
          travel,
        };
      }
    }
  }
}

const better = (a: Scored, b: Scored | undefined) =>
  b === undefined ||
  a.cost < b.cost ||
  (a.cost === b.cost && (a.rank < b.rank || (a.rank === b.rank && a.travel < b.travel)));

/**
 * Pick the cheapest callout position for a target among sides, distances and slides. Falls back to
 * `placeCallout`'s clamped placement when no candidate fits inside the image.
 */
export function planCallout(inp: PlanInput): PlannedPlacement {
  const gap = inp.gap ?? 10;
  const preferred = inp.preferred ?? "top";
  const order = [preferred, ...SIDES.filter((s) => s !== preferred)];
  let best: Scored | undefined;
  for (const cand of candidates(inp, order, gap)) if (better(cand, best)) best = cand;
  if (!best) {
    const p = placeCallout(inp);
    return { ...p, distance: gap, stem: null, overlap: 0 };
  }
  const { side, callout, arrow, distance, stem, overlap } = best;
  return { side, callout, arrow, distance, stem, overlap };
}
