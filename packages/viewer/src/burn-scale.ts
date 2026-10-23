// Caption-scale geometry for the burned renderer: layout runs at base size on an image shrunk by
// the caption scale, and these helpers convert annotations in and layouts out.

import type { Rect } from "./placement.js";
import type { CalloutLayout } from "./burn-callout.js";
import type { AnnotationRecord } from "./annotations.js";

export const scaleRect = (r: Rect, f: number): Rect =>
  f === 1 ? r : { x: r.x * f, y: r.y * f, width: r.width * f, height: r.height * f };
export const scalePoint = (p: { x: number; y: number }, f: number) =>
  f === 1 ? p : { x: p.x * f, y: p.y * f };

/** `ann` with every length divided by `f`: the annotation as laid out at base size. */
export function atBaseSize(ann: AnnotationRecord, f: number): AnnotationRecord {
  if (f === 1) return ann;
  return {
    ...ann,
    ...(ann.bounding_box ? { bounding_box: scaleRect(ann.bounding_box, 1 / f) } : {}),
    ...(ann.obstacles ? { obstacles: ann.obstacles.map((o) => scaleRect(o, 1 / f)) } : {}),
    ...(ann.nudge ? { nudge: scalePoint(ann.nudge, 1 / f) } : {}),
  };
}

/** A layout made at base size, in screenshot px: positions, sizes and overlaps multiplied by `f`. */
export function layoutAtScale(l: CalloutLayout, f: number): CalloutLayout {
  if (f === 1) return l;
  return {
    ...l,
    size: { width: l.size.width * f, height: l.size.height * f },
    callout: scalePoint(l.callout, f),
    arrow: l.arrow ? scalePoint(l.arrow, f) : null,
    stem: l.stem ? scaleRect(l.stem, f) : null,
    nudge: scalePoint(l.nudge, f),
    arrowLength: l.arrowLength * f,
    obstacleOverlap: Math.round(l.obstacleOverlap * f * f),
    otherOverlap: Math.round(l.otherOverlap * f * f),
  };
}
