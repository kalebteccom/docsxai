// Geometry and redraw rules for the viewer's overlay, kept free of the DOM so tests run them
// directly. overlay-runtime.ts bundles this file; viewer-style.ts builds the badge rule from the
// same numbers, so the clamp below and the drawn badge cannot drift apart.

/** Badge box parts, in CSS px. The badge is `box-sizing: content-box`. */
export const BADGE_MIN = 22;
export const BADGE_PAD_X = 6;
export const BADGE_BORDER = 2;
/** Outer size of a badge with one to three digits: min-width plus padding plus border. */
export const BADGE_WIDTH = BADGE_MIN + 2 * BADGE_PAD_X + 2 * BADGE_BORDER;
export const BADGE_HEIGHT = BADGE_MIN + 2 * BADGE_BORDER;
/** How far the badge sits up and left of the halo's top-left corner. */
export const BADGE_PULL = 8;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Top-left of a badge for a target, both in displayed image px: pulled up and left of the target,
 * then clamped so the whole badge (not just its inner 22 px) stays inside the image. On an image
 * narrower or shorter than the badge it sits at 0.
 */
export function badgeOrigin(
  target: Box,
  image: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(target.x - BADGE_PULL, image.width - BADGE_WIDTH)),
    y: Math.max(0, Math.min(target.y - BADGE_PULL, image.height - BADGE_HEIGHT)),
  };
}

/**
 * How far past the viewport a shot still counts as near, as an IntersectionObserver rootMargin:
 * one screen above and below, so overlays are drawn before they scroll into view.
 */
export const NEAR_MARGIN = "100% 0px 100% 0px";

export interface ShotState {
  /** Inside or near the viewport (always true without IntersectionObserver, and while printing). */
  near: boolean;
  /** The image has decoded with a size. */
  loaded: boolean;
  /** Displayed image width, CSS px. */
  width: number;
  /** Width the overlay was last drawn at (`data-drawn-width`), or undefined. */
  drawnWidth: string | undefined;
}

/** A shot's overlay is redrawn when it is near, loaded, and shown at a width it wasn't drawn at. */
export function needsRedraw(s: ShotState): boolean {
  return s.near && s.loaded && s.width > 0 && String(s.width) !== s.drawnWidth;
}
