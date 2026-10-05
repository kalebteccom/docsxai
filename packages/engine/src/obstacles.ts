// Obstacle selection — the pure half of `annotations.obstacles`.
//
// A driver reports the boxes of visible text and controls near an annotation's target
// ({@link NearbyBoxes}). This module turns that raw scan into the `obstacles` array written on an
// annotation record: boxes in screenshot pixels that a burned callout must not cover. No IO, no
// browser: same scan in, same boxes out, so the doc pack stays byte-identical across runs.

import { MAX_OBSTACLES, type BoundingBox } from "./doc-pack.js";

/** How far from the target (CSS px) page content still counts as an obstacle. */
export const OBSTACLE_RADIUS = 320;
/** The most obstacles one annotation records; the ones nearest the target win. */
export const OBSTACLE_LIMIT = MAX_OBSTACLES;

/** What a driver reports about the content around a target. Every box is in screenshot pixels. */
export interface NearbyBoxes {
  /** Screenshot size (viewport × device scale factor). */
  image: { width: number; height: number };
  /** Device scale factor: screenshot pixels per CSS pixel. */
  scale: number;
  /** Boxes of visible text and interactive elements, the target and its subtree already left out. */
  boxes: BoundingBox[];
}

export interface SelectOptions {
  /** Distance cut-off in CSS px. Default {@link OBSTACLE_RADIUS}. */
  radius?: number;
  /** Cap on the number of boxes. Default {@link OBSTACLE_LIMIT}. */
  limit?: number;
}

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EPSILON = 1e-6;

const edges = (b: BoundingBox): Edges => ({
  left: b.x,
  top: b.y,
  right: b.x + b.width,
  bottom: b.y + b.height,
});

/** Integer box that contains `b`, clipped to the image; `null` when nothing of it is left. */
function clipOutward(b: BoundingBox, image: NearbyBoxes["image"]): BoundingBox | null {
  const e = edges(b);
  const left = Math.max(0, Math.floor(e.left + EPSILON));
  const top = Math.max(0, Math.floor(e.top + EPSILON));
  const right = Math.min(image.width, Math.ceil(e.right - EPSILON));
  const bottom = Math.min(image.height, Math.ceil(e.bottom - EPSILON));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Straight-line gap between two boxes; 0 when they touch or overlap. */
function gap(a: BoundingBox, b: BoundingBox): number {
  const ea = edges(a);
  const eb = edges(b);
  const dx = Math.max(0, ea.left - eb.right, eb.left - ea.right);
  const dy = Math.max(0, ea.top - eb.bottom, eb.top - ea.bottom);
  return Math.hypot(dx, dy);
}

/** True when `inner` lies entirely inside `outer` (equal boxes count). */
function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  const o = edges(outer);
  const i = edges(inner);
  return o.left <= i.left && o.top <= i.top && o.right >= i.right && o.bottom >= i.bottom;
}

const byPosition = (a: BoundingBox, b: BoundingBox): number =>
  a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;

/**
 * Pick the obstacles for one annotation. `target` is the annotation's own box (screenshot px).
 *
 * Boxes are rounded outward to whole pixels, clipped to the image, and dropped when empty, when
 * farther than the radius from the target, when they sit entirely inside the target, or when
 * another kept box already covers them (a label inside a button). Duplicates collapse to one. If
 * more than the limit remain, the nearest to the target are kept. The result is sorted by y, x,
 * width, height.
 */
export function selectObstacles(
  scan: NearbyBoxes,
  target: BoundingBox,
  options: SelectOptions = {},
): BoundingBox[] {
  const radius = (options.radius ?? OBSTACLE_RADIUS) * scan.scale;
  const limit = options.limit ?? OBSTACLE_LIMIT;

  const unique = new Map<string, BoundingBox>();
  for (const raw of scan.boxes) {
    const box = clipOutward(raw, scan.image);
    if (!box || contains(target, box) || gap(box, target) > radius) continue;
    unique.set(`${box.x},${box.y},${box.width},${box.height}`, box);
  }
  const candidates = [...unique.values()];
  const exposed = candidates.filter(
    (box) => !candidates.some((other) => other !== box && contains(other, box)),
  );

  return exposed
    .map((box) => ({ box, distance: gap(box, target) }))
    .sort((a, b) => a.distance - b.distance || byPosition(a.box, b.box))
    .slice(0, limit)
    .map(({ box }) => box)
    .sort(byPosition);
}
