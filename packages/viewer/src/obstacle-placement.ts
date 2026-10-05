// Obstacle-aware callout placement for the burner.
//
// `placeCallout` (placement.ts) puts a callout adjacent to its target, so a narrow target beside
// text cannot slide far enough to clear it. This planner also tries callouts further out (a stem
// joins them to the arrow) and slid along the target's edge, scores every candidate by how much it
// covers, and keeps the cheapest. Pure and deterministic: candidates are enumerated in a fixed
// order and a candidate only replaces the best on a strictly better (cost, side rank, travel).

import { ARROW_LENGTH, arrowGeometry, stemGeometry } from "./arrow.js";
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
  /** Try only `preferred`'s side; the other sides are tried when it has no spot inside the image. */
  strictSide?: boolean;
  /** Where the callout rests along the target's edge before it slides. Default `"center"`. */
  align?: "start" | "center" | "end";
  /**
   * Fold `nudge` into the callout's distance and slide instead of moving callout and arrow
   * together: the arrow tip stays on the target and a stem joins it to the callout. The nudge is
   * bounded by what keeps the stem attached and the callout inside the image.
   */
  pinArrow?: boolean;
}

export interface PlannedPlacement extends Placement {
  /** Gap between the target edge and the callout edge. */
  distance: number;
  /** Bar from the arrow base to the callout edge; `null` when the callout sits at the base gap. */
  stem: Rect | null;
  /** Pixels of the callout and arrow still covering an obstacle or avoided box (0 = clear). */
  overlap: number;
  /** True when `nudge` is already part of `callout` and `stem`; the renderer must not add it again. */
  nudgeBaked?: boolean;
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
/** A slide range is cut into at most this many steps; only ranges over 1600 px coarsen the 8 px step. */
const MAX_SLIDE_STEPS = 200;
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

interface SlideRange {
  /** Callout start positions that keep a stem attachable, nearest the resting spot first. */
  starts: number[];
  lo: number;
  hi: number;
}

const ALIGN_FRACTION = { start: 0, center: 0.5, end: 1 } as const;

/** Callout start positions along the target's edge that keep a stem attachable, nearest first. */
export function slideStarts(
  span: { from: number; length: number },
  calloutLength: number,
  limit: number,
  align: "start" | "center" | "end" = "center",
): SlideRange {
  const inset = Math.min(ARROW_INSET, span.length / 2);
  const margin = Math.min(ATTACH_MARGIN, calloutLength / 2);
  const lo = Math.max(0, span.from + inset - calloutLength + margin);
  const hi = Math.min(limit - calloutLength, span.from + span.length - inset - margin);
  if (lo > hi) return { starts: [], lo, hi };
  const rest =
    align === "center"
      ? span.from + span.length / 2 - calloutLength / 2
      : span.from + (span.length - calloutLength) * ALIGN_FRACTION[align];
  const centred = clamp(rest, lo, hi);
  const starts = new Set<number>([centred, lo, hi]);
  const step = Math.max(SLIDE_STEP, Math.ceil((hi - lo) / MAX_SLIDE_STEPS));
  for (let s = step; centred - s >= lo || centred + s <= hi; s += step) {
    if (centred - s >= lo) starts.add(centred - s);
    if (centred + s <= hi) starts.add(centred + s);
  }
  return {
    starts: [...starts].sort((a, b) => Math.abs(a - centred) - Math.abs(b - centred) || a - b),
    lo,
    hi,
  };
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

/**
 * `nudge` as a move of the callout alone: its component across the target edge changes the
 * distance, its component along the edge slides the callout. Arrow tip and edge stay put.
 */
function pinnedOffsets(side: Side, nudge: { x: number; y: number }) {
  switch (side) {
    case "top":
      return { across: -nudge.y, along: nudge.x };
    case "bottom":
      return { across: nudge.y, along: nudge.x };
    case "left":
      return { across: -nudge.x, along: nudge.y };
    case "right":
      return { across: nudge.x, along: nudge.y };
  }
}

function* candidates(inp: PlanInput, order: Side[], gap: number): Generator<Scored> {
  const { image, target: t, callout: c } = inp;
  const nudge = inp.nudge ?? { x: 0, y: 0 };
  const pin = inp.pinArrow === true;
  const shiftBy = pin ? { x: 0, y: 0 } : nudge;
  const ctx: ScoreContext = { image, obstacles: inp.obstacles, avoid: inp.avoid ?? [] };
  for (const [rank, side] of order.entries()) {
    const horizontal = side === "top" || side === "bottom";
    const span = horizontal ? { from: t.x, length: t.width } : { from: t.y, length: t.height };
    const slide = slideStarts(
      span,
      horizontal ? c.width : c.height,
      horizontal ? image.width : image.height,
      inp.align,
    );
    const { starts } = slide;
    const centred = starts[0] ?? 0;
    const offsets = pin ? pinnedOffsets(side, nudge) : { across: 0, along: 0 };
    for (const extra of EXTRA_DISTANCES) {
      for (const baseStart of starts) {
        const distance = pin ? Math.max(ARROW_LENGTH, gap + extra + offsets.across) : gap + extra;
        const start = pin ? clamp(baseStart + offsets.along, slide.lo, slide.hi) : baseStart;
        const l = layout(side, inp, distance, start);
        const rect = { x: l.x, y: l.y, width: c.width, height: c.height };
        const inside =
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= image.width &&
          rect.y + rect.height <= image.height;
        if (!inside) continue;
        const a = arrowGeometry(side, l.arrow);
        const stem = (pin ? distance > gap : extra > 0)
          ? stemGeometry(side, l.arrow, distance)
          : null;
        const connector = [
          { x: a.left, y: a.top, width: a.width, height: a.height },
          ...(stem ? [stem] : []),
        ].map((r) => shift(r, shiftBy));
        const { cost, overlap } = scorePlacement({ callout: shift(rect, shiftBy), connector }, ctx);
        // Travel is measured from the un-nudged candidate, so a nudge is not charged as a detour.
        const travel = extra * STEM_COST + Math.abs(baseStart - centred) * SLIDE_COST;
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
  const search = (sides: Side[]) => {
    let found: Scored | undefined;
    for (const cand of candidates(inp, sides, gap)) if (better(cand, found)) found = cand;
    return found;
  };
  const best = (inp.strictSide ? search([preferred]) : undefined) ?? search(order);
  if (!best) {
    const p = placeCallout(inp);
    return { ...p, distance: gap, stem: null, overlap: 0 };
  }
  const { side, callout, arrow, distance, stem, overlap } = best;
  return {
    side,
    callout,
    arrow,
    distance,
    stem,
    overlap,
    ...(inp.pinArrow ? { nudgeBaked: true } : {}),
  };
}
