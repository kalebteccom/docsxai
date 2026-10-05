import { describe, expect, it } from "vitest";
import {
  fitsInside,
  INSIDE_MARGIN,
  MIN_INSIDE_WIDTH,
  planInside,
} from "../src/inside-placement.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";

const image = { width: 390, height: 844 };
const panel: Rect = { x: 32, y: 500, width: 326, height: 317 };
const callout = { width: 240, height: 75 };
const rectAt = (p: { x: number; y: number }): Rect => ({ ...p, ...callout });

describe("fitsInside", () => {
  it("needs the callout plus a margin on every side", () => {
    expect(fitsInside(panel, callout)).toBe(true);
    const edge = { x: 0, y: 0, width: 240 + 2 * INSIDE_MARGIN, height: 75 + 2 * INSIDE_MARGIN };
    expect(fitsInside(edge, callout)).toBe(true);
    expect(fitsInside({ ...edge, width: edge.width - 1 }, callout)).toBe(false);
    expect(fitsInside({ ...edge, height: edge.height - 1 }, callout)).toBe(false);
  });

  it("keeps the minimum inside width below the callout width ladder's floor", () => {
    expect(MIN_INSIDE_WIDTH).toBeLessThan(168);
  });
});

describe("planInside", () => {
  it("rests against the top edge, centred, when nothing is in the way", () => {
    const p = planInside({ image, target: panel, callout, obstacles: [] })!;
    expect(p.overlap).toBe(0);
    expect(p.callout).toEqual({
      x: panel.x + (panel.width - callout.width) / 2,
      y: panel.y + INSIDE_MARGIN,
    });
  });

  it("rests against the side and along the edge it is told to", () => {
    const rest = (side: "top" | "bottom" | "left" | "right", align?: "start" | "center" | "end") =>
      planInside({
        image,
        target: panel,
        callout,
        obstacles: [],
        side,
        ...(align ? { align } : {}),
      })!.callout;
    const left = panel.x + INSIDE_MARGIN;
    const right = panel.x + panel.width - INSIDE_MARGIN - callout.width;
    const top = panel.y + INSIDE_MARGIN;
    const bottom = panel.y + panel.height - INSIDE_MARGIN - callout.height;
    expect(rest("bottom").y).toBe(bottom);
    expect(rest("top", "start").x).toBe(left);
    expect(rest("top", "end").x).toBe(right);
    expect(rest("left")).toEqual({ x: left, y: top + (bottom - top) / 2 });
    expect(rest("right")).toEqual({ x: right, y: top + (bottom - top) / 2 });
  });

  it("moves to a clear spot when the preferred one is covered by content", () => {
    const header = { x: 32, y: 500, width: 326, height: 120 };
    const p = planInside({ image, target: panel, callout, obstacles: [header] })!;
    expect(p.overlap).toBe(0);
    expect(overlapArea(rectAt(p.callout), header)).toBe(0);
    expect(p.callout.y).toBeGreaterThanOrEqual(header.y + header.height);
  });

  it("keeps clear of avoided boxes, such as another halo inside the target", () => {
    const halo = { x: 32, y: 500, width: 326, height: 60 };
    const p = planInside({ image, target: panel, callout, obstacles: [], avoid: [halo] })!;
    expect(overlapArea(rectAt(p.callout), halo)).toBe(0);
  });

  it("reports the overlap of the best spot when the target is full of content", () => {
    const wall = { x: 32, y: 500, width: 326, height: 317 };
    const p = planInside({ image, target: panel, callout, obstacles: [wall] })!;
    expect(p.overlap).toBe(callout.width * callout.height);
  });

  it("starts from the nudged resting spot and stays inside the target", () => {
    const plain = planInside({ image, target: panel, callout, obstacles: [] })!;
    const nudged = planInside({
      image,
      target: panel,
      callout,
      obstacles: [],
      nudge: { x: 20, y: 30 },
    })!;
    expect(nudged.callout.y).toBe(plain.callout.y + 30);
    const far = planInside({
      image,
      target: panel,
      callout,
      obstacles: [],
      nudge: { x: 999, y: 999 },
    })!;
    expect(far.callout.x + callout.width).toBeLessThanOrEqual(
      panel.x + panel.width - INSIDE_MARGIN,
    );
    expect(far.callout.y + callout.height).toBeLessThanOrEqual(
      panel.y + panel.height - INSIDE_MARGIN,
    );
  });

  it("returns null when the callout cannot sit inside both the target and the image", () => {
    expect(
      planInside({ image, target: { x: 0, y: 0, width: 100, height: 50 }, callout, obstacles: [] }),
    ).toBeNull();
  });

  it("is deterministic", () => {
    const input = {
      image,
      target: panel,
      callout,
      obstacles: [{ x: 60, y: 520, width: 200, height: 14 }],
      avoid: [{ x: 40, y: 700, width: 30, height: 30 }],
    };
    expect(planInside(input)).toEqual(planInside(input));
  });

  it("stays cheap on a page-sized target", () => {
    const page = { x: 0, y: 0, width: 1280, height: 3000 };
    const t0 = Date.now();
    const p = planInside({
      image: { width: 1280, height: 3000 },
      target: page,
      callout,
      obstacles: Array.from({ length: 40 }, (_, i) => ({
        x: 20,
        y: 100 * i,
        width: 600,
        height: 14,
      })),
    })!;
    expect(p.overlap).toBe(0);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
