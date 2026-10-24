// Connector routing for the line look. The clean planner keeps a caption off content, but its line
// may still cross text when every side of a target is crowded. When it does, this module looks for
// a caption spot whose straight line crosses nothing, preferring the hinted side and then the
// shortest line; failing that, a line with one right-angle elbow whose two legs cross nothing. When
// neither exists the planner's layout stays. Pure and deterministic: candidates are enumerated in a
// fixed order and one replaces the best only on a strictly lower cost.

import type { Rect, Side } from "./placement.js";
import { layoutBoxes, type CalloutLayout, type LayoutInput } from "./burn-callout.js";
import { crossingLength, overlapArea, slideStarts } from "./obstacle-placement.js";
import { LINE_GAP, LINE_MAX_DISTANCE, LINE_STROKE, linePath } from "./burn-line.js";
import { RING_OUTSET } from "./burn-clean.js";
import { captionCover, type CleanPlan } from "./burn-clean-plan.js";
import { OUTWARD, segmentRect } from "./line-elbow.js";

type Pt = { x: number; y: number };
type Size = { width: number; height: number };

/** How a line connector reaches its target; `none` when no line is drawn. */
export type RouteKind = "straight" | "elbow" | "none";

/** Step between distances tried, base px. */
const DISTANCE_STEP = 4;
/** Step between elbow legs and caption slides tried, base px. */
const LEG_STEP = 8;
/** Shortest first leg of an elbow, base px past the halo ring: its 3 px glow, half the stroke and 2 px. */
const MIN_FIRST_LEG = 6;
/** Step between first legs tried, base px: fine, since a first leg often fits a thin gap. */
const FIRST_LEG_STEP = 2;
/** Shortest second leg, base px, so the caption keeps clear of the first. */
const MIN_SECOND_LEG = 12;
/** Points along the target's edge an elbow may leave from. */
const ELBOW_TIPS = 5;
/** The arrow tip stays this far inside the target's ends, as in the planner. */
const TIP_INSET = 6;
/** A caption keeps this many px off content. */
const CLEARANCE = 4;
/** Added to a line that runs under its own badge: any clean route without that wins. */
const BADGE_COST = 1000;
const SLIDE_COST = 0.5;
/** Cost per px a line's end sits from the caption's middle, so a centred line wins a tie. */
const TIP_COST = 0.1;
const SIDES: readonly Side[] = ["top", "bottom", "right", "left"];

export interface RouteInput {
  target: Rect;
  image: Size;
  /** The caption box. */
  size: Size;
  /** Boxes neither line nor caption may touch: page content, other halos, badges and captions. */
  blockers: Rect[];
  /**
   * Boxes the line alone may not cross, when fewer than `blockers`. Such a route is the last
   * resort: the caption keeps off the blockers without {@link CLEARANCE}, and the line's end may
   * slide along the target's edge.
   */
  lineBlockers?: Rect[];
  /** Further boxes the caption may not cover. */
  forbid: Rect[];
  /** The annotation's own badge: the line may pass under it, at {@link BADGE_COST}. */
  ownBadge?: Rect;
  preferred: Side;
  /** Try `preferred` alone first and keep its best clean spot. */
  hinted: boolean;
  align?: "start" | "center" | "end";
  /** Added to caption and line of a straight route, as the renderer adds it. */
  nudge: Pt;
  /** The line keeps this far from the caption's corners, base px. */
  inset: number;
}

/** A routed spot, in the fields of {@link CalloutLayout} it sets, before nudge. */
export interface RoutedSpot {
  side: Side;
  callout: Pt;
  arrow: Pt;
  stem: Rect | null;
  elbow?: Pt;
  size: Size;
  nudge: Pt;
}

export interface Route {
  kind: "straight" | "elbow";
  side: Side;
  layout: RoutedSpot;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const add = (p: Pt, d: Pt, k = 1): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  width: r.width + 2 * m,
  height: r.height + 2 * m,
});

interface Ctx {
  inp: RouteInput;
  /** Boxes a caption keeps clear of, grown by the clearance where they are content. */
  captionBlocks: Rect[];
}

const lineCrosses = (ctx: Ctx, seg: Rect) =>
  crossingLength(seg, ctx.inp.lineBlockers ?? ctx.inp.blockers) > 0;
const badgeCost = (ctx: Ctx, segs: Rect[]) =>
  ctx.inp.ownBadge && segs.some((s) => overlapArea(s, ctx.inp.ownBadge!) > 0) ? BADGE_COST : 0;

function captionClear(ctx: Ctx, r: Rect): boolean {
  const { image } = ctx.inp;
  const inside =
    r.x >= 0 && r.y >= 0 && r.x + r.width <= image.width && r.y + r.height <= image.height;
  return inside && ctx.captionBlocks.every((b) => overlapArea(r, b) === 0);
}

/** The target's edge on `side`: where along it a tip may sit, and its coordinate across. */
function edgeOf(t: Rect, side: Side) {
  const horizontal = side === "top" || side === "bottom";
  const from = horizontal ? t.x : t.y;
  const length = horizontal ? t.width : t.height;
  const inset = Math.min(TIP_INSET, length / 2);
  const across = { top: t.y, bottom: t.y + t.height, left: t.x, right: t.x + t.width }[side];
  const tip = (along: number): Pt =>
    horizontal ? { x: along, y: across } : { x: across, y: along };
  return { horizontal, from, length, lo: from + inset, hi: from + length - inset, tip };
}

interface Best {
  cost: number;
  route: Route;
}

/**
 * Where along the edge a straight line may end for a caption slid to one spot: the point nearest
 * the caption's middle. A route held to fewer blockers (`lineBlockers`) also tries points further
 * along, so its line can pass beside a caption drawn before it.
 */
function tipsFor(ctx: Ctx, mid: number, lo: number, hi: number): number[] {
  const tips = [mid];
  if (!ctx.inp.lineBlockers) return tips;
  for (let s = LEG_STEP; mid - s >= lo || mid + s <= hi; s += LEG_STEP) {
    if (mid - s >= lo) tips.push(mid - s);
    if (mid + s <= hi) tips.push(mid + s);
  }
  return tips;
}

/** Straight candidates on one side, scored by line length and slide. */
function straightOn(ctx: Ctx, side: Side, best: Best | undefined): Best | undefined {
  const { target: t, size, image, nudge, inset } = ctx.inp;
  const e = edgeOf(t, side);
  const out = OUTWARD[side];
  const len = e.horizontal ? size.width : size.height;
  const limit = e.horizontal ? image.width : image.height;
  const { starts } = slideStarts({ from: e.from, length: e.length }, len, limit, ctx.inp.align);
  const rest = starts[0] ?? 0;
  const room = {
    top: t.y,
    bottom: image.height - t.y - t.height,
    left: t.x,
    right: image.width - t.x - t.width,
  }[side];
  const depth = e.horizontal ? size.height : size.width;
  for (let d = LINE_GAP; best === undefined || d - RING_OUTSET < best.cost; d += DISTANCE_STEP) {
    if (d + depth > room) break;
    for (const start of starts) {
      const lo = Math.max(e.lo, start + inset);
      const hi = Math.min(e.hi, start + len - inset);
      if (lo > hi) continue;
      const mid = clamp(start + len / 2, lo, hi);
      for (const along of tipsFor(ctx, mid, lo, hi)) {
        const tip = e.tip(along);
        const edgePt = add(tip, out, d);
        const callout = e.horizontal
          ? { x: start, y: side === "top" ? edgePt.y - size.height : edgePt.y }
          : { x: side === "left" ? edgePt.x - size.width : edgePt.x, y: start };
        const spot = { ...callout, ...size, x: callout.x + nudge.x, y: callout.y + nudge.y };
        if (!captionClear(ctx, spot)) break;
        const seg = segmentRect(
          add(add(tip, out, RING_OUTSET), nudge),
          add(edgePt, nudge),
          LINE_STROKE / 2,
        );
        if (lineCrosses(ctx, seg)) continue;
        const cost =
          d -
          RING_OUTSET +
          SLIDE_COST * Math.abs(start - rest) +
          TIP_COST * Math.abs(along - mid) +
          badgeCost(ctx, [seg]);
        if (best !== undefined && cost >= best.cost) continue;
        const stem = segmentRect(tip, edgePt, LINE_STROKE / 2);
        best = {
          cost,
          route: {
            kind: "straight",
            side,
            layout: { side, callout, arrow: tip, stem, size, nudge },
          },
        };
      }
    }
  }
  return best;
}

/** Up to {@link ELBOW_TIPS} points along an edge, the middle first. */
function tipsAlong(lo: number, hi: number): number[] {
  const mid = (lo + hi) / 2;
  if (hi - lo < 1) return [mid];
  const n = ELBOW_TIPS - 1;
  const all = Array.from({ length: ELBOW_TIPS }, (_, i) => lo + ((hi - lo) * i) / n);
  return all.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

/** Caption positions along the second leg's cross axis that keep `at` on the caption edge. */
function slidesFor(at: number, len: number, inset: number, limit: number): number[] {
  const lo = Math.max(0, at - len + inset);
  const hi = Math.min(limit - len, at - inset);
  if (lo > hi) return [];
  const centred = clamp(at - len / 2, lo, hi);
  const out = [centred];
  for (let s = LEG_STEP; centred - s >= lo || centred + s <= hi; s += LEG_STEP) {
    if (centred - s >= lo) out.push(centred - s);
    if (centred + s <= hi) out.push(centred + s);
  }
  return out;
}

/** Elbow candidates leaving the target from `side`, scored by total line length and slide. */
function elbowFrom(ctx: Ctx, side: Side, best: Best | undefined): Best | undefined {
  const { target: t, size, image, inset } = ctx.inp;
  const e = edgeOf(t, side);
  const out = OUTWARD[side];
  const turns: Pt[] = e.horizontal ? [OUTWARD.right, OUTWARD.left] : [OUTWARD.bottom, OUTWARD.top];
  const inImage = (p: Pt) => p.x >= 0 && p.y >= 0 && p.x <= image.width && p.y <= image.height;
  for (const along of tipsAlong(e.lo, e.hi)) {
    const tip = e.tip(along);
    const ring = add(tip, out, RING_OUTSET);
    for (let d1 = MIN_FIRST_LEG; d1 <= LINE_MAX_DISTANCE; d1 += FIRST_LEG_STEP) {
      if (best !== undefined && d1 + MIN_SECOND_LEG >= best.cost) break;
      const corner = add(ring, out, d1);
      const first = segmentRect(ring, corner, LINE_STROKE / 2);
      if (!inImage(corner) || lineCrosses(ctx, first)) break;
      for (const turn of turns) {
        for (let d2 = MIN_SECOND_LEG; best === undefined || d1 + d2 < best.cost; d2 += LEG_STEP) {
          const end = add(corner, turn, d2);
          const second = segmentRect(corner, end, LINE_STROKE / 2);
          if (!inImage(end) || lineCrosses(ctx, second)) break;
          const across = e.horizontal ? corner.y : corner.x;
          const lenAcross = e.horizontal ? size.height : size.width;
          const limit = e.horizontal ? image.height : image.width;
          for (const s of slidesFor(across, lenAcross, inset, limit)) {
            const callout = e.horizontal
              ? { x: turn.x > 0 ? end.x : end.x - size.width, y: s }
              : { x: s, y: turn.y > 0 ? end.y : end.y - size.height };
            if (!captionClear(ctx, { ...callout, ...size })) continue;
            const slide = Math.abs(s - (across - lenAcross / 2));
            const cost = d1 + d2 + SLIDE_COST * slide + badgeCost(ctx, [first, second]);
            if (best === undefined || cost < best.cost) {
              const layout = { side, callout, arrow: tip, stem: null, elbow: corner, size };
              best = {
                cost,
                route: { kind: "elbow", side, layout: { ...layout, nudge: { x: 0, y: 0 } } },
              };
            }
            break;
          }
        }
      }
    }
  }
  return best;
}

/**
 * The caption spot whose line crosses none of `blockers`: straight on the hinted side when it has
 * one, else the shortest straight line on any side, else the shortest line with one elbow. `null`
 * when every route crosses something or no caption spot is clear.
 */
export function routeLine(inp: RouteInput): Route | null {
  const halo = inflate(inp.target, RING_OUTSET + 3);
  const captionBlocks = [
    ...inp.blockers.map((b) => inflate(b, inp.lineBlockers ? 0 : CLEARANCE)),
    ...inp.forbid,
    ...(inp.ownBadge ? [inp.ownBadge] : []),
    halo,
  ];
  const ctx: Ctx = { inp, captionBlocks };
  if (inp.hinted) {
    const hinted = straightOn(ctx, inp.preferred, undefined);
    if (hinted) return hinted.route;
  }
  const order = [inp.preferred, ...SIDES.filter((s) => s !== inp.preferred)];
  let best: Best | undefined;
  for (const side of order) best = straightOn(ctx, side, best);
  if (best) return best.route;
  for (const side of order) best = elbowFrom(ctx, side, best);
  return best ? best.route : null;
}

/** Count of `boxes` the drawn line of `l` runs through (a brush under 2 px does not count). */
export function lineCrossings(l: CalloutLayout, boxes: Rect[], inset: number): number {
  const path = linePath(l, inset, RING_OUTSET);
  if (!path) return 0;
  const segs = path.points.slice(1).map((p, i) => segmentRect(path.points[i]!, p, LINE_STROKE / 2));
  return boxes.filter((b) => segs.some((s) => crossingLength(s, [b]) > 0)).length;
}

const covered = (boxes: Rect[], against: Rect[]) =>
  boxes.reduce((n, r) => n + against.reduce((m, o) => m + overlapArea(r, o), 0), 0);

export interface RoutedPlan {
  plan: CleanPlan;
  route: RouteKind;
  /** Boxes the drawn line still crosses; 0 once routed. */
  crossings: number;
}

/**
 * Re-routes a clean plan whose line crosses page content or another annotation while its caption
 * covers nothing. A route is kept only when it covers no more than the plan did. `f` is the
 * caption scale and `ownBadge` this annotation's badge at base size.
 */
export function routeClean(
  inp: LayoutInput,
  plan: CleanPlan,
  f: number,
  ownBadge?: Rect,
): RoutedPlan {
  const l = plan.layout;
  if (l.mode === "inside" || !l.side) return { plan, route: "none", crossings: 0 };
  const inset = plan.theme.radius / f + LINE_STROKE;
  const obstacles = inp.ann.obstacles ?? [];
  const blockers = [...obstacles, ...inp.clear.filter((r) => r !== ownBadge)];
  const crossings = lineCrossings(l, blockers, inset);
  const kept: RoutedPlan = { plan, route: "straight", crossings };
  if (crossings === 0 || captionCover(inp, l) > 0) return kept;
  const placement = inp.ann.placement;
  const styled = (inp.ann.arrow_style ?? "").split("-")[0] as Side;
  const hint = placement?.side ?? (SIDES.includes(styled) ? styled : undefined);
  const reroute = (lineBlockers: Rect[] | undefined): RoutedPlan | null => {
    const found = routeLine({
      target: inp.target,
      image: inp.image,
      size: l.size,
      blockers,
      ...(lineBlockers ? { lineBlockers } : {}),
      forbid: inp.forbid ?? [],
      ...(ownBadge ? { ownBadge } : {}),
      preferred: hint ?? l.side!,
      hinted: hint !== undefined,
      ...(placement?.align ? { align: placement.align } : {}),
      nudge: l.nudge,
      inset,
    });
    if (!found) return null;
    const { elbow: _straight, ...rest } = l;
    const spot = { ...rest, ...found.layout };
    const boxes = layoutBoxes(spot);
    const layout: CalloutLayout = {
      ...spot,
      obstacleOverlap: Math.round(covered(boxes, obstacles)),
      otherOverlap: Math.round(covered(boxes, inp.clear)),
    };
    if (layout.obstacleOverlap + layout.otherOverlap > l.obstacleOverlap + l.otherOverlap) {
      return null;
    }
    return {
      plan: { ...plan, layout, cover: 0 },
      route: found.kind,
      crossings: lineBlockers ? lineCrossings(layout, blockers, inset) : 0,
    };
  };
  const clean = reroute(undefined);
  if (clean) return clean;
  // No route crosses nothing. A line may still cross content or a halo, but never runs behind a
  // caption or badge drawn before it.
  const behind = (inp.forbid ?? []).map((b) => inflate(b, LINE_STROKE));
  if (behind.length === 0 || lineCrossings(l, behind, inset) === 0) return kept;
  return reroute(behind) ?? kept;
}
