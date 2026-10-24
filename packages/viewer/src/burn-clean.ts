// The clean look that goes with the line connector: the halo ring drawn outside its target with a
// gap, so it never covers text inside the target, and text areas estimated from the pixels on top of
// the obstacles an annotation lists. Pure.

import { growRect } from "./arrow.js";
import { busyCells, showsText, textBoxes, type BusyCells } from "./pixel-obstacles.js";
import { overlapArea } from "./obstacle-placement.js";
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
/** Share of the image height a docked caption may sit from its target. */
export const DOCK_MAX_SHARE = 0.45;
/** Smallest burned text a caption shrinks to before it may cover anything: phone, desktop. */
export const MIN_TEXT_NARROW = 14;
export const MIN_TEXT_WIDE = 16;
/** Screenshot width in px from which {@link MIN_TEXT_WIDE} applies. */
export const WIDE_FROM = 900;
/** Gap between a clean badge and its target's corner, px. */
export const BADGE_GAP = 1;

/** The box the halo is drawn on, in screenshot px: the target, or with `clean` the ring outside it. */
export function haloBox(target: Rect, clean: boolean, f: number): Rect {
  return clean ? growRect(target, RING_OUTSET * f) : target;
}

const cellCache = new WeakMap<PixelGrid, BusyCells>();
const cellsOf = (pixels: PixelGrid): BusyCells => {
  let cells = cellCache.get(pixels);
  if (!cells) {
    cells = busyCells(pixels);
    cellCache.set(pixels, cells);
  }
  return cells;
};

/**
 * `ann` (at base size) with obstacles checked against the pixels. A listed box with nothing drawn
 * in it (an element a capture found in the page but that shows nothing, such as a collapsed list)
 * is dropped, and text boxes estimated from the whole screenshot are added, so the planner keeps
 * the caption off text the sidecar did not list (sidecars cap their list). `real` is the target in
 * screenshot px and `f` the caption scale.
 */
export function withPixelObstacles(
  ann: AnnotationRecord,
  real: Rect,
  pixels: PixelGrid,
  f: number,
): AnnotationRecord {
  const cells = cellsOf(pixels);
  const listed = (ann.obstacles ?? []).filter((o) =>
    showsText(cells, { x: o.x * f, y: o.y * f, width: o.width * f, height: o.height * f }),
  );
  const found = textBoxes(cells, growRect(real, 2 * f)).map((b) =>
    f === 1 ? b : { x: b.x / f, y: b.y / f, width: b.width / f, height: b.height / f },
  );
  return { ...ann, obstacles: [...listed, ...found] };
}

/** `ann` with the targets of the other annotations in `all` added to its obstacles. */
export function withOtherTargets(
  ann: AnnotationRecord,
  all: AnnotationRecord[],
  self: AnnotationRecord,
): AnnotationRecord {
  const others = all.flatMap((a) => (a !== self && a.bounding_box ? [a.bounding_box] : []));
  return others.length === 0 ? ann : { ...ann, obstacles: [...(ann.obstacles ?? []), ...others] };
}

type Size = { width: number; height: number };

/**
 * The badge of the clean look: diagonally off one of the target's corners, {@link BADGE_GAP} px
 * from it, never on the target and never detached. Corners are tried top-left, top-right,
 * bottom-left, bottom-right; the first inside the image and clear of `blockers` wins, else the
 * one covering least.
 */
export function cornerBadge(target: Rect, size: Size, image: Size, blockers: Rect[]): Rect {
  const g = BADGE_GAP;
  const xs = [target.x - size.width - g, target.x + target.width + g];
  const ys = [target.y - size.height - g, target.y + target.height + g];
  const corners = [
    { x: xs[0]!, y: ys[0]! },
    { x: xs[1]!, y: ys[0]! },
    { x: xs[0]!, y: ys[1]! },
    { x: xs[1]!, y: ys[1]! },
  ].map((p) => ({ ...p, ...size }));
  let best: Rect | undefined;
  let bestCost = Infinity;
  for (const c of corners) {
    const inside =
      c.x >= 0 && c.y >= 0 && c.x + c.width <= image.width && c.y + c.height <= image.height;
    const cost = blockers.reduce((n, b) => n + overlapArea(c, b), 0) + (inside ? 0 : 1e9);
    if (cost === 0) return c;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  const b = best!;
  return {
    ...b,
    x: Math.max(0, Math.min(b.x, image.width - b.width)),
    y: Math.max(0, Math.min(b.y, image.height - b.height)),
  };
}

/**
 * Text size factors to try for a caption of `fontSize` base px at caption scale `f` on a
 * screenshot `imageWidth` px wide: 1, then one smaller step down to the floor of its width class,
 * when the floor is under the current size.
 */
export function shrinkSteps(fontSize: number, f: number, imageWidth: number): number[] {
  const floor = imageWidth >= WIDE_FROM ? MIN_TEXT_WIDE : MIN_TEXT_NARROW;
  const burned = fontSize * f;
  return burned > floor ? [1, floor / burned] : [1];
}
