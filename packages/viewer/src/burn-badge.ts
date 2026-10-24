// Badge boxes and keep-clear boxes for the burned renderer, all in base-size screenshot px.

import type { Rect } from "./placement.js";
import { anchorBadge, BADGE_DEFAULT_OFFSET, BADGE_INNER } from "./badge-placement.js";
import { growRect } from "./arrow.js";
import { measureText, type FontMetrics } from "./font-metrics.js";
import type { Size } from "./burn-callout.js";
import type { AnnotationRecord, BoundingBox } from "./annotations.js";

export const BADGE_BORDER = 2;
export const BADGE_FONT_SIZE = 12;
/** Margin of the keep-clear box around another annotation's halo (border + glow + slack). */
const HALO_MARGIN = 6;

/** Outer size of the numbered badge: the circle widens for multi-digit indexes. */
export function badgeSize(index: number, metrics: FontMetrics): Size {
  return {
    width: Math.max(
      BADGE_INNER + 2 * BADGE_BORDER,
      Math.ceil(measureText(String(index), BADGE_FONT_SIZE, metrics)) + 12 + 2 * BADGE_BORDER,
    ),
    height: BADGE_INNER + 2 * BADGE_BORDER,
  };
}

/**
 * The box a badge of `size` is anchored to: the target itself, or with `outside` the target grown
 * so the badge's box ends 1 px short of the target at a corner, clear of the element and its text.
 */
export function badgeAnchor(t: BoundingBox, size: Size, outside = false): Rect {
  return outside ? growRect(t, size.width - BADGE_DEFAULT_OFFSET + 1) : t;
}

/**
 * Default box of the numbered badge: top-left of the halo, pulled slightly outside it, clamped to
 * the image. With `outside`, diagonally off the target's top-left corner (see {@link badgeAnchor}).
 */
export function badgeBox(
  t: BoundingBox,
  index: number,
  image: Size,
  metrics: FontMetrics,
  outside = false,
): Rect {
  const size = badgeSize(index, metrics);
  return anchorBadge(badgeAnchor(t, size, outside), "top-left", BADGE_DEFAULT_OFFSET, size, image);
}

/** Margin around a halo drawn outside its target (gap, ring and glow, plus slack). */
export const OUTSIDE_HALO_MARGIN = 10;

/** Keep-clear boxes around every other annotation's halo, `margin` px out. */
export function otherHalos(
  annotations: AnnotationRecord[],
  self: AnnotationRecord,
  margin: number = HALO_MARGIN,
): Rect[] {
  return annotations.flatMap((other) =>
    other !== self && other.bounding_box ? [growRect(other.bounding_box, margin)] : [],
  );
}

/**
 * What an annotation's callout must stay clear of besides page content: halos, badges, earlier
 * callouts. Badges already planned stand where they were put; the rest at their default spot.
 * `outside`: halos and badges sit outside their targets (the line connector's look).
 */
export function keepClear(
  annotations: AnnotationRecord[],
  self: AnnotationRecord,
  image: Size,
  metrics: FontMetrics,
  placed: Rect[],
  badges: Map<AnnotationRecord, Rect>,
  outside = false,
): Rect[] {
  const clear: Rect[] = [];
  for (const other of annotations) {
    const box = other.bounding_box;
    if (!box) continue;
    if (other !== self) clear.push(growRect(box, outside ? OUTSIDE_HALO_MARGIN : HALO_MARGIN));
    if (typeof other.index === "number") {
      clear.push(badges.get(other) ?? badgeBox(box, other.index, image, metrics, outside));
    }
  }
  return [...clear, ...placed];
}
