// Corner choice for the burner's numbered badge.
//
// The default badge sits 8 px up-left of the target's halo. Against text that starts flush with the
// target (a title, a tab, a list row) that corner lands on a neighbour's glyphs. When the annotation
// carries `obstacles`, `planBadge` also tries the other three corners and a few steps further out,
// and keeps the position that covers the least page content. Pure and deterministic: candidates are
// enumerated in a fixed order and replace the best only on a strictly lower score.

import { overlapArea } from "./obstacle-placement.js";
import type { Rect } from "./placement.js";

export type BadgeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** The badge's circle diameter without its border; also the room the image-edge clamp leaves it. */
export const BADGE_INNER = 22;
/** How far the default badge sticks out past the halo's corner. */
export const BADGE_DEFAULT_OFFSET = 8;
/** Outward offsets tried per corner, in px, nearest first. The first is the default. */
const OFFSETS = [BADGE_DEFAULT_OFFSET, 14, 20, 26];
const CORNERS: readonly BadgeCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

type Size = { width: number; height: number };

export interface BadgeInput {
  image: Size;
  target: Rect;
  /** Outer size of the badge (circle plus border). */
  size: Size;
  /** Boxes of page content the badge must not cover. */
  obstacles: Rect[];
  /** Further boxes to keep clear: other annotations' halos, callouts already placed. */
  avoid?: Rect[];
}

/**
 * Badge box at a corner of the target, `offset` px past the halo's corner, clamped to the image.
 * `("top-left", 8)` is the long-standing default position.
 */
export function anchorBadge(
  target: Rect,
  corner: BadgeCorner,
  offset: number,
  size: Size,
  image: Size,
): Rect {
  const left = corner === "top-left" || corner === "bottom-left";
  const top = corner === "top-left" || corner === "top-right";
  const x = left ? target.x - offset : target.x + target.width + offset - size.width;
  const y = top ? target.y - offset : target.y + target.height + offset - size.height;
  return {
    x: Math.max(0, Math.min(x, image.width - BADGE_INNER)),
    y: Math.max(0, Math.min(y, image.height - BADGE_INNER)),
    width: size.width,
    height: size.height,
  };
}

const covered = (box: Rect, against: Rect[]) =>
  against.reduce((sum, r) => sum + overlapArea(box, r), 0);

/**
 * Pick the badge box for a target: the default up-left spot when it covers nothing, otherwise the
 * corner and offset covering the least obstacle and avoided area. Ties on that go to the box
 * overlapping the target least (it hides fewer of the target's own glyphs), then to enumeration
 * order (nearest offset, then up-left, up-right, down-left, down-right).
 */
export function planBadge(inp: BadgeInput): Rect {
  const avoid = inp.avoid ?? [];
  let best: { box: Rect; conflict: number; onTarget: number } | undefined;
  for (const offset of OFFSETS) {
    for (const corner of CORNERS) {
      const box = anchorBadge(inp.target, corner, offset, inp.size, inp.image);
      const conflict = covered(box, inp.obstacles) + covered(box, avoid);
      if (conflict === 0 && best === undefined) return box;
      const onTarget = overlapArea(box, inp.target);
      if (
        best === undefined ||
        conflict < best.conflict ||
        (conflict === best.conflict && onTarget < best.onTarget)
      ) {
        best = { box, conflict, onTarget };
      }
    }
  }
  return best!.box;
}
