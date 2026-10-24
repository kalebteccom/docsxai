// Keeps an annotation's `bounding_box` inside the screenshot before it reaches the rasteriser.
// resvg aborts the whole process on a degenerate or far-off shape, so a box the burner can't draw
// is skipped (with a reason) and a box that only overhangs an edge is clamped to the image.

import type { AnnotationRecord, BoundingBox } from "./annotations.js";

export type FitResult = { box: BoundingBox } | { skip: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The box clipped to the image, or the reason it can't be drawn. */
export function fitBox(box: BoundingBox, image: { width: number; height: number }): FitResult {
  if (!isNum(box.x) || !isNum(box.y) || !isNum(box.width) || !isNum(box.height)) {
    return { skip: "bounding_box is not a finite number" };
  }
  if (box.width <= 0 || box.height <= 0) {
    return { skip: `bounding_box has no area (${box.width}x${box.height})` };
  }
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(image.width, box.x + box.width);
  const y1 = Math.min(image.height, box.y + box.height);
  if (x1 <= x0 || y1 <= y0) {
    return {
      skip: `bounding_box (${box.x},${box.y} ${box.width}x${box.height}) is outside the ${image.width}x${image.height} image`,
    };
  }
  return { box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

/** `ann` with its box clipped to the image, or the reason it can't be drawn. */
export function fitAnnotation(
  ann: AnnotationRecord,
  image: { width: number; height: number },
): { ann: AnnotationRecord } | { skip: string } {
  if (!ann.bounding_box) return { skip: "no bounding_box" };
  const fit = fitBox(ann.bounding_box, image);
  if ("skip" in fit) return fit;
  const same =
    fit.box.x === ann.bounding_box.x &&
    fit.box.y === ann.bounding_box.y &&
    fit.box.width === ann.bounding_box.width &&
    fit.box.height === ann.bounding_box.height;
  return { ann: same ? ann : { ...ann, bounding_box: fit.box } };
}
