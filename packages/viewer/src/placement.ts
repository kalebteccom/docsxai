// Popper-like placement for annotation callouts.
//
// Given an image, a target bounding box within it, and a callout's size, pick the side + position for the
// callout (and the arrow tip) so the callout stays inside the image and doesn't cover the target. Pure,
// coordinate-space-agnostic (use displayed px for the interactive viewer, screenshot px for the burner).
//
// The interactive viewer's inline OVERLAY_JS is a hand-port of `placeCallout` — keep the two in sync.
// The static burner (`burn.ts`, when it lands) calls `placeCallout` directly.

export type Side = "top" | "bottom" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaceInput {
  image: { width: number; height: number };
  target: Rect;
  callout: { width: number; height: number };
  /** Preferred side, tried first (from the flow-file's `annotation.arrow`). Default: `"top"`. */
  preferred?: Side;
  /** Gap between target and callout, in px. Default: `10`. */
  gap?: number;
}

export interface Placement {
  side: Side;
  /** Top-left of the callout, in image coords. */
  callout: { x: number; y: number };
  /** Tip of the arrow — touches the target edge, points away from the callout — in image coords. */
  arrow: { x: number; y: number };
}

const SIDES: Side[] = ["top", "bottom", "right", "left"];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fits(side: Side, inp: PlaceInput, gap: number): boolean {
  const { image, target, callout } = inp;
  switch (side) {
    case "top":
      return target.y - gap - callout.height >= 0;
    case "bottom":
      return target.y + target.height + gap + callout.height <= image.height;
    case "left":
      return target.x - gap - callout.width >= 0;
    case "right":
      return target.x + target.width + gap + callout.width <= image.width;
  }
}

function roomOn(side: Side, inp: PlaceInput): number {
  const { image, target } = inp;
  switch (side) {
    case "top":
      return target.y;
    case "bottom":
      return image.height - (target.y + target.height);
    case "left":
      return target.x;
    case "right":
      return image.width - (target.x + target.width);
  }
}

/** Place a callout around a target inside an image. Always returns something on-screen (clamped if nothing fits). */
export function placeCallout(inp: PlaceInput): Placement {
  const gap = inp.gap ?? 10;
  const preferred = inp.preferred ?? "top";
  const order = [preferred, ...SIDES.filter((s) => s !== preferred)];
  const side = order.find((s) => fits(s, inp, gap)) ?? [...order].sort((a, b) => roomOn(b, inp) - roomOn(a, inp))[0]!;

  const { image, target, callout } = inp;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  let x: number, y: number, ax: number, ay: number;
  switch (side) {
    case "top":
      x = cx - callout.width / 2;
      y = target.y - gap - callout.height;
      ax = clamp(cx, 0, image.width);
      ay = target.y;
      break;
    case "bottom":
      x = cx - callout.width / 2;
      y = target.y + target.height + gap;
      ax = clamp(cx, 0, image.width);
      ay = target.y + target.height;
      break;
    case "left":
      x = target.x - gap - callout.width;
      y = cy - callout.height / 2;
      ax = target.x;
      ay = clamp(cy, 0, image.height);
      break;
    case "right":
      x = target.x + target.width + gap;
      y = cy - callout.height / 2;
      ax = target.x + target.width;
      ay = clamp(cy, 0, image.height);
      break;
  }
  // keep the callout fully inside the image
  x = clamp(x, 0, Math.max(0, image.width - callout.width));
  y = clamp(y, 0, Math.max(0, image.height - callout.height));
  return { side, callout: { x, y }, arrow: { x: ax, y: ay } };
}
