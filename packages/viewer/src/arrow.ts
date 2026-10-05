// Arrow + stem geometry for burned callouts. Pure; shared by the burner (drawing) and the obstacle
// planner (scoring), so the planner scores the exact boxes the burner paints.

import type { Rect, Side } from "./placement.js";

export const ARROW_HALF = 7;
export const ARROW_LENGTH = 8;
/** Thickness of the stem joining a detached callout to its arrow. */
export const STEM_WIDTH = 2;

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
export function arrowGeometry(side: Side, tip: { x: number; y: number }): ArrowGeometry {
  const base = ARROW_HALF * 2;
  switch (side) {
    case "top": // callout above → arrow points down
      return {
        left: tip.x - ARROW_HALF,
        top: tip.y - ARROW_LENGTH,
        width: base,
        height: ARROW_LENGTH,
        clipPath: "polygon(0% 0%, 100% 0%, 50% 100%)",
      };
    case "bottom": // callout below → arrow points up
      return {
        left: tip.x - ARROW_HALF,
        top: tip.y,
        width: base,
        height: ARROW_LENGTH,
        clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
      };
    case "left": // callout left → arrow points right
      return {
        left: tip.x - ARROW_LENGTH,
        top: tip.y - ARROW_HALF,
        width: ARROW_LENGTH,
        height: base,
        clipPath: "polygon(0% 0%, 100% 50%, 0% 100%)",
      };
    case "right": // callout right → arrow points left
      return {
        left: tip.x,
        top: tip.y - ARROW_HALF,
        width: ARROW_LENGTH,
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
): Rect | null {
  const length = distance - ARROW_LENGTH;
  if (length <= 0) return null;
  const half = STEM_WIDTH / 2;
  switch (side) {
    case "top":
      return { x: tip.x - half, y: tip.y - distance, width: STEM_WIDTH, height: length };
    case "bottom":
      return { x: tip.x - half, y: tip.y + ARROW_LENGTH, width: STEM_WIDTH, height: length };
    case "left":
      return { x: tip.x - distance, y: tip.y - half, width: length, height: STEM_WIDTH };
    case "right":
      return { x: tip.x + ARROW_LENGTH, y: tip.y - half, width: length, height: STEM_WIDTH };
  }
}
