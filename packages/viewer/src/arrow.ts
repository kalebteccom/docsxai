// Arrow + stem geometry for burned callouts. Pure; shared by the burner (drawing) and the obstacle
// planner (scoring), so the planner scores the exact boxes the burner paints.

import type { Rect, Side } from "./placement.js";

export const ARROW_HALF = 7;
export const ARROW_LENGTH = 8;
/** Thickness of the stem joining a detached callout to its arrow. */
export const STEM_WIDTH = 2;

/** Half the arrow's base for an arrow `length` px long: 7 for the default 8, the same 7:8 shape at any size. */
export const halfBase = (length: number): number => (length * ARROW_HALF) / ARROW_LENGTH;

export interface ArrowGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Triangle outline; the box is filled with INK and clipped to this shape. */
  clipPath: string;
}

/**
 * Triangle geometry for the callout arrow, tip at `tip` on the target's edge — the static mirror
 * of the viewer's `.sd-arrow.<side>` CSS triangles (7px half-base, 8px length). Satori renders
 * CSS border-triangles as filled boxes, so the burner clips an INK box to a polygon instead.
 */
export function arrowGeometry(
  side: Side,
  tip: { x: number; y: number },
  length: number = ARROW_LENGTH,
): ArrowGeometry {
  const half = halfBase(length);
  const base = half * 2;
  switch (side) {
    case "top": // callout above → arrow points down
      return {
        left: tip.x - half,
        top: tip.y - length,
        width: base,
        height: length,
        clipPath: "polygon(0% 0%, 100% 0%, 50% 100%)",
      };
    case "bottom": // callout below → arrow points up
      return {
        left: tip.x - half,
        top: tip.y,
        width: base,
        height: length,
        clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
      };
    case "left": // callout left → arrow points right
      return {
        left: tip.x - length,
        top: tip.y - half,
        width: length,
        height: base,
        clipPath: "polygon(0% 0%, 100% 50%, 0% 100%)",
      };
    case "right": // callout right → arrow points left
      return {
        left: tip.x,
        top: tip.y - half,
        width: length,
        height: base,
        clipPath: "polygon(100% 0%, 100% 100%, 0% 50%)",
      };
  }
}

/**
 * The thin bar from the arrow's base to the callout edge, for a callout `distance` px away from the
 * target edge. `null` when the arrow base already reaches the callout (distance <= ARROW_LENGTH).
 */
export function stemGeometry(
  side: Side,
  tip: { x: number; y: number },
  distance: number,
  arrowLength: number = ARROW_LENGTH,
): Rect | null {
  const length = distance - arrowLength;
  if (length <= 0) return null;
  const half = STEM_WIDTH / 2;
  switch (side) {
    case "top":
      return { x: tip.x - half, y: tip.y - distance, width: STEM_WIDTH, height: length };
    case "bottom":
      return { x: tip.x - half, y: tip.y + arrowLength, width: STEM_WIDTH, height: length };
    case "left":
      return { x: tip.x - distance, y: tip.y - half, width: length, height: STEM_WIDTH };
    case "right":
      return { x: tip.x + arrowLength, y: tip.y - half, width: length, height: STEM_WIDTH };
  }
}

type Pt = { x: number; y: number };

/** The arrow's triangle in image space, in the order `arrowGeometry`'s polygon lists it. */
function arrowVertices(side: Side, tip: Pt, arrowLength: number): [Pt, Pt, Pt] {
  const { x, y } = tip;
  const len = arrowLength;
  const half = halfBase(arrowLength);
  switch (side) {
    case "top":
      return [
        { x: x - half, y: y - len },
        { x: x + half, y: y - len },
        { x, y },
      ];
    case "bottom":
      return [
        { x, y },
        { x: x + half, y: y + len },
        { x: x - half, y: y + len },
      ];
    case "left":
      return [
        { x: x - len, y: y - half },
        { x, y },
        { x: x - len, y: y + half },
      ];
    case "right":
      return [
        { x: x + len, y: y - half },
        { x: x + len, y: y + half },
        { x, y },
      ];
  }
}

/** Where the lines `a + s*da` and `b + t*db` cross (the triangle's edges never run parallel). */
function crossing(a: Pt, da: Pt, b: Pt, db: Pt): Pt {
  const s = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / (da.x * db.y - da.y * db.x);
  return { x: a.x + s * da.x, y: a.y + s * da.y };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The arrow's triangle grown outward by `margin` px on every edge (mitred corners), as a box and a
 * px polygon in the same shape as {@link arrowGeometry}. Painted in a light colour under the ink
 * arrow it outlines it on dark pixels. The tip reaches about 1.5 x `margin` past the ink tip.
 */
export function arrowHaloGeometry(
  side: Side,
  tip: Pt,
  margin: number,
  arrowLength: number = ARROW_LENGTH,
): ArrowGeometry {
  const v = arrowVertices(side, tip, arrowLength);
  const centre = { x: (v[0].x + v[1].x + v[2].x) / 3, y: (v[0].y + v[1].y + v[2].y) / 3 };
  // Each edge moved `margin` away from the centre along its normal: a point and a direction.
  const edges = v.map((p, i) => {
    const q = v[(i + 1) % 3]!;
    const d = { x: q.x - p.x, y: q.y - p.y };
    const len = Math.hypot(d.x, d.y);
    let n = { x: d.y / len, y: -d.x / len };
    if (n.x * (p.x - centre.x) + n.y * (p.y - centre.y) < 0) n = { x: -n.x, y: -n.y };
    return { p: { x: p.x + n.x * margin, y: p.y + n.y * margin }, d };
  });
  // Vertex i sits where the edges before and after it cross.
  const grown = v.map((_, i) => {
    const prev = edges[(i + 2) % 3]!;
    const next = edges[i]!;
    return crossing(prev.p, prev.d, next.p, next.d);
  });
  const left = Math.floor(Math.min(...grown.map((p) => p.x)));
  const top = Math.floor(Math.min(...grown.map((p) => p.y)));
  const right = Math.ceil(Math.max(...grown.map((p) => p.x)));
  const bottom = Math.ceil(Math.max(...grown.map((p) => p.y)));
  const points = grown.map((p) => `${round2(p.x - left)}px ${round2(p.y - top)}px`).join(", ");
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    clipPath: `polygon(${points})`,
  };
}

/** `r` grown by `margin` px on every side. */
export function growRect(r: Rect, margin: number): Rect {
  return {
    x: r.x - margin,
    y: r.y - margin,
    width: r.width + 2 * margin,
    height: r.height + 2 * margin,
  };
}
