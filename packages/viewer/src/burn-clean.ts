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
/** Phone chrome, CSS px (times the pixel ratio `pr` on a 2x capture): header and bottom nav height, the floating button's box, side margin. */
export const CHROME_BAR = 56;
export const FAB_BOX = { width: 76, height: 80 };
export const SIDE_MARGIN = 16;

/**
 * Boxes, at base size, a caption on a phone capture (portrait, under {@link WIDE_FROM} px wide) may not cover:
 * the header bar, the bottom nav bar, the floating action button above it and, with `margins`, a
 * {@link SIDE_MARGIN} px strip at each side. Empty for a desktop capture. `f` is the caption scale,
 * `realWidth` the capture's CSS width and `pr` its device pixel ratio (1 when `image` is in CSS px).
 */
export function chromeBoxes(
  image: Size,
  f: number,
  realWidth: number,
  margins: boolean,
  pr = 1,
): Rect[] {
  if (realWidth >= WIDE_FROM || image.height <= image.width) return [];
  const bar = (CHROME_BAR * pr) / f;
  const { width: W, height: H } = image;
  const boxes: Rect[] = [
    { x: 0, y: 0, width: W, height: bar },
    { x: 0, y: H - bar, width: W, height: bar },
    {
      x: W - (FAB_BOX.width * pr) / f,
      y: H - bar - (FAB_BOX.height * pr) / f,
      width: (FAB_BOX.width * pr) / f,
      height: (FAB_BOX.height * pr) / f,
    },
  ];
  if (margins) {
    const m = (SIDE_MARGIN * pr) / f;
    boxes.push({ x: 0, y: 0, width: m, height: H }, { x: W - m, y: 0, width: m, height: H });
  }
  return boxes;
}

/** Margin of the docking bands, base px: past the phone chrome on a phone capture. */
export const dockMargin = (f: number, realWidth: number, image: Size, pr = 1): number =>
  chromeBoxes(image, f, realWidth, false, pr).length === 0
    ? DOCK_MARGIN
    : ((CHROME_BAR + 8) * pr) / f;

/** The box the halo is drawn on, in screenshot px: the target, or with `clean` the ring outside it. */
export function haloBox(target: Rect, clean: boolean, f: number): Rect {
  return clean ? growRect(target, RING_OUTSET * f) : target;
}

const cellCache = new WeakMap<PixelGrid, BusyCells>();
const cellsOf = (pixels: PixelGrid, pr: number): BusyCells => {
  let cells = cellCache.get(pixels);
  if (!cells) {
    cells = busyCells(pixels, pr);
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
  pr = 1,
): AnnotationRecord {
  const cells = cellsOf(pixels, pr);
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
 * The obstacles of a clean annotation (at base size): its listed boxes checked against the pixels,
 * text found in them, the other annotations' targets and the phone chrome. `badgeObstacles` leaves
 * out the side margins, so a badge may sit at the image edge next to its target.
 */
export function cleanObstacles(
  self: AnnotationRecord,
  realTarget: Rect | undefined,
  pixels: PixelGrid | undefined,
  f: number,
  all: AnnotationRecord[],
  image: Size,
  realWidth: number,
  pr = 1,
): { ann: AnnotationRecord; badgeObstacles: Rect[] } {
  const seen = pixels && realTarget ? withPixelObstacles(self, realTarget, pixels, f, pr) : self;
  const ann = withOtherTargets(seen, all, self);
  const listed = ann.obstacles ?? [];
  // A badge must not cover text inside its own target either.
  const inside =
    pixels && realTarget
      ? textBoxes(cellsOf(pixels, pr), { x: 0, y: 0, width: 0, height: 0 })
          .filter((b) => overlapArea(b, realTarget) > 0)
          .map((b) => ({ x: b.x / f, y: b.y / f, width: b.width / f, height: b.height / f }))
      : [];
  const badgeObstacles = [...listed, ...inside, ...chromeBoxes(image, f, realWidth, false, pr)];
  return {
    ann: { ...ann, obstacles: [...listed, ...chromeBoxes(image, f, realWidth, true, pr)] },
    badgeObstacles,
  };
}

/**
 * The badge of the clean look: diagonally off one of the target's corners, {@link BADGE_GAP} px
 * from it, never on the target and never detached. Corners are tried top-left, top-right,
 * bottom-left, bottom-right, then beside the middle of the left and right edges, then the inside
 * of the target's top-left corner; the first inside the
 * image and clear of `blockers` wins, else the one covering least.
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
  ].map((p): Rect & { inside?: boolean } => ({ ...p, ...size }));
  // Then the middle of the left and right edges, outside, for a target whose corners sit on text.
  const midY = target.y + target.height / 2 - size.height / 2;
  corners.push({ x: xs[0]!, y: midY, ...size }, { x: xs[1]!, y: midY, ...size });
  // Last resort: inside the target's top-left padding, when the target is big enough to hold it.
  if (target.width >= size.width + 8 && target.height >= size.height + 8) {
    corners.push({ x: target.x + 4, y: target.y + 4, ...size, inside: true });
  }
  let best: Rect | undefined;
  let bestCost = Infinity;
  for (const { inside, ...raw } of corners) {
    // A corner past the image edge slides back in along that edge, still next to the target.
    const c = {
      ...raw,
      x: Math.max(0, Math.min(raw.x, image.width - raw.width)),
      y: Math.max(0, Math.min(raw.y, image.height - raw.height)),
    };
    const onTarget = inside ? 0 : overlapArea(c, target);
    const cost = blockers.reduce((n, b) => n + overlapArea(c, b), 0) + onTarget * 1000;
    if (cost === 0) return c;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best!;
}

/**
 * Text size factors to try for a caption of `fontSize` base px at caption scale `f` on a
 * screenshot `imageWidth` px wide: 1, then one smaller step down to the floor of its width class,
 * when the floor is under the current size.
 */
export function shrinkSteps(fontSize: number, f: number, imageWidth: number, pr = 1): number[] {
  const floor = (imageWidth >= WIDE_FROM ? MIN_TEXT_WIDE : MIN_TEXT_NARROW) * pr;
  const burned = fontSize * f;
  return burned > floor ? [1, floor / burned] : [1];
}
