// The clean look that goes with the line connector: the halo ring drawn outside its target with a
// gap, so it never covers text inside the target, and text areas estimated from the pixels on top of
// the obstacles an annotation lists. Pure.

import { growRect } from "./arrow.js";
import { textBoxes } from "./pixel-obstacles.js";
import type { PixelGrid } from "./connector-contrast.js";
import type { Rect } from "./placement.js";
import type { AnnotationRecord } from "./annotations.js";

/** Gap between the target and the clean halo ring, base px. */
export const HALO_GAP = 3;
/** Width of the halo ring, base px; the same in both looks. */
export const HALO_RING = 2;
/** Base px past the target edge where the clean ring's outer edge sits; the line ends there. */
export const RING_OUTSET = HALO_GAP + HALO_RING;
/** Margin in base px of the top and bottom bands a line-joined caption may dock in. */
export const DOCK_MARGIN = 12;
/** How far around a target, in base px, text is estimated from the pixels. */
export const TEXT_REACH = 260;

/** The box the halo is drawn on, in screenshot px: the target, or with `clean` the ring outside it. */
export function haloBox(target: Rect, clean: boolean, f: number): Rect {
  return clean ? growRect(target, RING_OUTSET * f) : target;
}

/**
 * `ann` (at base size) with text boxes estimated from the pixels added to its `obstacles`, so the
 * planner keeps the caption off text a capture sidecar did not list (sidecars cap their list).
 * `real` is the target in screenshot px and `f` the caption scale. Unchanged for a callout placed
 * inside its target.
 */
export function withPixelObstacles(
  ann: AnnotationRecord,
  real: Rect,
  pixels: PixelGrid,
  f: number,
): AnnotationRecord {
  if (ann.placement?.inside === true) return ann;
  const boxes = textBoxes(pixels, real, TEXT_REACH * f, growRect(real, 2 * f));
  if (boxes.length === 0) return ann;
  const base =
    f === 1
      ? boxes
      : boxes.map((b) => ({ x: b.x / f, y: b.y / f, width: b.width / f, height: b.height / f }));
  return { ...ann, obstacles: [...(ann.obstacles ?? []), ...base] };
}
