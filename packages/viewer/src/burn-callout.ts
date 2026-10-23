// Callout sizing and layout for the burner: what box a callout gets and where it goes.
//
// `layoutCallout` is the one entry point. Without `obstacles` or placement settings it is exactly
// today's path: a 280 px box next to the target via `placeCallout`. With them it plans: the box
// width adapts to the screenshot, a narrower box is tried when the full one has no clear spot, and
// `placement` can pin a side, align the callout, keep the arrow on the target under `nudge`, or put
// the callout inside a large target. Pure and deterministic: widths are tried widest first and a
// narrower one wins only on strictly less overlap.

import { placeCallout, type Rect, type Side } from "./placement.js";
import { overlapArea, planCallout } from "./obstacle-placement.js";
import { fitsInside, INSIDE_MARGIN, MIN_INSIDE_WIDTH, planInside } from "./inside-placement.js";
import { ARROW_LENGTH, arrowGeometry } from "./arrow.js";
import { measureText, wrapText, type FontMetrics } from "./font-metrics.js";
import type { AnnotationPlacement, AnnotationRecord, BoundingBox } from "./annotations.js";

export const FONT_SIZE = 14;
export const LINE_HEIGHT = 19;
export const CALLOUT_PADDING_X = 11;
export const CALLOUT_PADDING_Y = 8;
export const CALLOUT_BORDER = 1;

/** What sizes a callout box: the text and the room around it. A theme sets these. */
export interface CalloutStyle {
  fontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  borderWidth: number;
}

export const DEFAULT_CALLOUT_STYLE: CalloutStyle = {
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  paddingX: CALLOUT_PADDING_X,
  paddingY: CALLOUT_PADDING_Y,
  borderWidth: CALLOUT_BORDER,
};
/** Same outer-width clamp as the interactive overlay's measuring probe. */
export const MAX_CALLOUT_WIDTH = 280;
/** With obstacles, a callout is at most this share of the screenshot's width (and at least the floor). */
export const ADAPTIVE_WIDTH_RATIO = 0.62;
/** Narrowest outer width the burner shrinks a callout to while looking for a clear spot. */
export const CALLOUT_WIDTH_FLOOR = 168;
/** Bounds `placement.max_width` is clamped to; the engine schema holds the same range. */
const PLACEMENT_WIDTH_RANGE = { min: 120, max: 560 };
const SIDES: readonly string[] = ["top", "bottom", "left", "right"];

export type Size = { width: number; height: number };
type Point = { x: number; y: number };

export interface CalloutLayout {
  lines: string[];
  size: Size;
  mode: "outside" | "inside";
  /** Side of the target the callout sits on; `null` inside the target. */
  side: Side | null;
  /** Top-left of the callout before `nudge`. */
  callout: Point;
  /** Arrow tip on the target's edge, before `nudge`; `null` inside the target. */
  arrow: Point | null;
  /** Bar from the arrow to a detached callout, before `nudge`. */
  stem: Rect | null;
  /** Arrow length in px, for the boxes {@link layoutBoxes} gives. */
  arrowLength: number;
  /** Offset still to add to callout, arrow and stem when drawing. */
  nudge: Point;
  /** Px² of callout, arrow and stem on obstacles. */
  obstacleOverlap: number;
  /** Px² of callout, arrow and stem on other halos, badges and earlier callouts. */
  otherOverlap: number;
}

export interface LayoutInput {
  ann: AnnotationRecord;
  target: BoundingBox;
  image: Size;
  metrics: FontMetrics;
  /** Boxes to keep clear besides obstacles: other halos, badges, callouts already placed. */
  clear: Rect[];
  /** Text size and padding of the box. Default {@link DEFAULT_CALLOUT_STYLE}. */
  style?: CalloutStyle;
  /** Arrow length in px; the callout keeps 2 px more than that from its target. Default {@link ARROW_LENGTH}. */
  arrowLength?: number;
  /** Widest callout as a share of the image's width when obstacles limit it. Default {@link ADAPTIVE_WIDTH_RATIO}. */
  maxWidthRatio?: number;
}

/** True when `arrow_style` names a side: the author asked for it, it is not the default. */
function hintsSide(arrowStyle: string | undefined): boolean {
  return arrowStyle !== undefined && SIDES.includes(arrowStyle.split("-")[0] ?? "");
}

function preferredSide(arrowStyle: string | undefined): Side {
  const pref = (arrowStyle ?? "top").split("-")[0] ?? "top";
  return SIDES.includes(pref) ? (pref as Side) : "top";
}

/** Wraps the callout copy to `maxWidth` and sizes the box around it. */
export function measureCallout(
  label: string,
  metrics: FontMetrics,
  maxWidth: number = MAX_CALLOUT_WIDTH,
  style: CalloutStyle = DEFAULT_CALLOUT_STYLE,
): { lines: string[]; size: Size } {
  const inset = style.paddingX + style.borderWidth;
  const contentMax = maxWidth - 2 * inset;
  const lines = wrapText(label, style.fontSize, contentMax, metrics);
  const contentWidth = Math.min(
    Math.ceil(Math.max(...lines.map((l) => measureText(l, style.fontSize, metrics)))),
    contentMax,
  );
  return {
    lines,
    size: {
      width: contentWidth + 2 * inset,
      height: lines.length * style.lineHeight + 2 * (style.paddingY + style.borderWidth),
    },
  };
}

/** True when any placement key that steers the burner is set (the capture-time keys do not count). */
function steersBurner(p: AnnotationPlacement | undefined): p is AnnotationPlacement {
  return (
    p !== undefined &&
    (p.inside !== undefined ||
      p.side !== undefined ||
      p.align !== undefined ||
      p.pin_arrow !== undefined ||
      p.max_width !== undefined)
  );
}

/**
 * Outer widths to try for one callout, widest first. No `obstacles` and no `max_width`: the
 * long-standing 280 px. With `obstacles` the widest is `min(280, 0.62 x image width)`, floored, and
 * on a screenshot narrow enough to shrink it two narrower boxes follow. An explicit `max_width`
 * replaces the widest and gets the same two fallbacks.
 */
export function widthLadder(
  imageWidth: number,
  hasObstacles: boolean,
  placement?: AnnotationPlacement,
  maxWidthRatio: number = ADAPTIVE_WIDTH_RATIO,
): number[] {
  const explicit = placement?.max_width;
  const usable = typeof explicit === "number" && Number.isFinite(explicit);
  let widest = MAX_CALLOUT_WIDTH;
  if (usable) {
    widest = Math.round(
      Math.max(PLACEMENT_WIDTH_RANGE.min, Math.min(PLACEMENT_WIDTH_RANGE.max, explicit)),
    );
  } else if (hasObstacles) {
    widest = Math.min(
      MAX_CALLOUT_WIDTH,
      Math.max(CALLOUT_WIDTH_FLOOR, Math.round(maxWidthRatio * imageWidth)),
    );
  }
  const shrinks = usable || widest < MAX_CALLOUT_WIDTH;
  if (!shrinks || widest <= CALLOUT_WIDTH_FLOOR) return [widest];
  const mid = Math.round((widest + CALLOUT_WIDTH_FLOOR) / 2);
  const hasMid = widest - mid >= 16 && mid - CALLOUT_WIDTH_FLOOR >= 16;
  return hasMid ? [widest, mid, CALLOUT_WIDTH_FLOOR] : [widest, CALLOUT_WIDTH_FLOOR];
}

const shift = (r: Rect, d: Point): Rect => ({ ...r, x: r.x + d.x, y: r.y + d.y });

/** Boxes a laid-out callout paints, nudge applied: the callout first, then arrow and stem. */
export function layoutBoxes(l: CalloutLayout): Rect[] {
  const boxes: Rect[] = [{ x: l.callout.x, y: l.callout.y, ...l.size }];
  if (l.side && l.arrow) {
    const a = arrowGeometry(l.side, l.arrow, l.arrowLength);
    boxes.push({ x: a.left, y: a.top, width: a.width, height: a.height });
  }
  if (l.stem) boxes.push(l.stem);
  return boxes.map((b) => shift(b, l.nudge));
}

const covered = (boxes: Rect[], against: Rect[]) =>
  boxes.reduce((sum, r) => sum + against.reduce((s, o) => s + overlapArea(r, o), 0), 0);

/** Fills in the overlap fields from the boxes the layout would paint. */
function withOverlap(
  l: Omit<CalloutLayout, "obstacleOverlap" | "otherOverlap" | "arrowLength">,
  obstacles: Rect[],
  clear: Rect[],
  arrowLength: number,
): CalloutLayout {
  const boxes = layoutBoxes({ ...l, arrowLength, obstacleOverlap: 0, otherOverlap: 0 });
  return {
    ...l,
    arrowLength,
    obstacleOverlap: Math.round(covered(boxes, obstacles)),
    otherOverlap: Math.round(covered(boxes, clear)),
  };
}

function layoutAtWidth(inp: LayoutInput, label: string, width: number): CalloutLayout {
  const { ann, target, image, metrics, clear } = inp;
  const style = inp.style ?? DEFAULT_CALLOUT_STYLE;
  const arrowLength = inp.arrowLength ?? ARROW_LENGTH;
  const gap = arrowLength + 2;
  const placement = ann.placement;
  const obstacles = ann.obstacles ?? [];
  const nudge = { x: ann.nudge?.x ?? 0, y: ann.nudge?.y ?? 0 };
  const preferred = placement?.side ?? preferredSide(ann.arrow_style);

  if (placement?.inside === true) {
    const insideWidth = Math.min(width, Math.floor(target.width - 2 * INSIDE_MARGIN));
    if (insideWidth >= MIN_INSIDE_WIDTH) {
      const { lines, size } = measureCallout(label, metrics, insideWidth, style);
      const spot =
        fitsInside(target, size) &&
        planInside({
          image,
          target,
          callout: size,
          obstacles,
          avoid: clear,
          nudge,
          side: preferred,
          ...(placement.align ? { align: placement.align } : {}),
        });
      if (spot) {
        return withOverlap(
          {
            lines,
            size,
            mode: "inside",
            side: null,
            callout: spot.callout,
            arrow: null,
            stem: null,
            nudge: { x: 0, y: 0 },
          },
          obstacles,
          clear,
          arrowLength,
        );
      }
    }
  }

  const { lines, size } = measureCallout(label, metrics, width, style);
  const input = { image, target, callout: size, preferred, gap };
  const planned = steersBurner(placement) || obstacles.length > 0;
  const p = planned
    ? planCallout({
        ...input,
        obstacles,
        avoid: clear,
        nudge,
        ...(placement?.side ? { strictSide: true } : {}),
        ...(placement?.side !== undefined || hintsSide(ann.arrow_style) ? { hinted: true } : {}),
        ...(placement?.align ? { align: placement.align } : {}),
        ...(placement?.pin_arrow ? { pinArrow: true } : {}),
        arrowLength,
      })
    : { ...placeCallout(input), stem: null, nudgeBaked: false };
  return withOverlap(
    {
      lines,
      size,
      mode: "outside",
      side: p.side,
      callout: p.callout,
      arrow: p.arrow,
      stem: p.stem,
      nudge: p.nudgeBaked ? { x: 0, y: 0 } : nudge,
    },
    obstacles,
    clear,
    arrowLength,
  );
}

/**
 * Lay out one annotation's callout. Tries each width of {@link widthLadder} and keeps the first
 * (widest) layout that covers nothing; when none is clear, the one that covers least, the widest
 * among equals.
 */
export function layoutCallout(inp: LayoutInput): CalloutLayout {
  const { ann, image } = inp;
  const label = (typeof ann.index === "number" ? `${ann.index}. ` : "") + ann.copy;
  const widths = widthLadder(
    image.width,
    (ann.obstacles?.length ?? 0) > 0,
    ann.placement,
    inp.maxWidthRatio,
  );
  let best: CalloutLayout | undefined;
  for (const width of widths) {
    const layout = layoutAtWidth(inp, label, width);
    const overlap = layout.obstacleOverlap + layout.otherOverlap;
    if (overlap === 0) return layout;
    if (best === undefined || overlap < best.obstacleOverlap + best.otherOverlap) best = layout;
  }
  return best!;
}
