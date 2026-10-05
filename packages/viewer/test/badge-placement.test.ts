import { describe, expect, it } from "vitest";
import { anchorBadge, planBadge } from "../src/badge-placement.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";

const IMAGE = { width: 800, height: 600 };
const SIZE = { width: 26, height: 26 };

// A title flush with a back arrow on its left and a breadcrumb row above it.
const TITLE: Rect = { x: 100, y: 100, width: 120, height: 24 };
const LEFT_NEIGHBOUR: Rect = { x: 40, y: 96, width: 56, height: 32 };
const ABOVE_NEIGHBOUR: Rect = { x: 100, y: 70, width: 200, height: 24 };

const plan = (obstacles: Rect[], avoid?: Rect[], target: Rect = TITLE) =>
  planBadge({ image: IMAGE, target, size: SIZE, obstacles, ...(avoid ? { avoid } : {}) });
const defaultBox = (target: Rect = TITLE) => anchorBadge(target, "top-left", 8, SIZE, IMAGE);

describe("anchorBadge", () => {
  it("top-left at offset 8 is the long-standing position: 8 px up-left of the target", () => {
    expect(defaultBox()).toEqual({ x: 92, y: 92, width: 26, height: 26 });
  });

  it("mirrors the offset to the other corners so the badge always sticks out past the halo", () => {
    expect(anchorBadge(TITLE, "top-right", 8, SIZE, IMAGE)).toEqual({
      x: 202,
      y: 92,
      width: 26,
      height: 26,
    });
    expect(anchorBadge(TITLE, "bottom-left", 8, SIZE, IMAGE)).toEqual({
      x: 92,
      y: 106,
      width: 26,
      height: 26,
    });
    expect(anchorBadge(TITLE, "bottom-right", 8, SIZE, IMAGE)).toEqual({
      x: 202,
      y: 106,
      width: 26,
      height: 26,
    });
  });

  it("clamps into the image", () => {
    const corner = { x: 2, y: 3, width: 10, height: 10 };
    expect(anchorBadge(corner, "top-left", 8, SIZE, IMAGE)).toMatchObject({ x: 0, y: 0 });
    const far = { x: 790, y: 595, width: 10, height: 5 };
    expect(anchorBadge(far, "bottom-right", 8, SIZE, IMAGE)).toMatchObject({ x: 778, y: 578 });
  });
});

describe("planBadge", () => {
  it("with nothing around, moves off the target's own box to the nearest clear corner", () => {
    // the default box sits on the target's first glyphs; up-left at 26 px is the first spot clear of it
    expect(overlapArea(defaultBox(), TITLE)).toBeGreaterThan(0);
    const box = plan([]);
    expect(box).toEqual(anchorBadge(TITLE, "top-left", 26, SIZE, IMAGE));
    expect(overlapArea(box, TITLE)).toBe(0);
    expect(plan([{ x: 500, y: 400, width: 50, height: 20 }])).toEqual(box);
  });

  it("keeps the badge off a flush-text target's own box when a corner is clear", () => {
    // text box = target box, neighbours packed tight on all four sides
    const target = { x: 300, y: 200, width: 90, height: 18 };
    const ring = [
      { x: 200, y: 196, width: 74, height: 26 },
      { x: 418, y: 196, width: 74, height: 26 },
      { x: 300, y: 150, width: 90, height: 24 },
      { x: 300, y: 244, width: 90, height: 24 },
    ];
    const box = plan(ring, [], target);
    expect(overlapArea(box, target)).toBe(0);
    for (const o of ring) expect(overlapArea(box, o)).toBe(0);
  });

  it("weighs an obstacle at twice the target: a sliver of obstacle beats a hidden target glyph", () => {
    // every spot at 26 px is blocked by 1 px² of text; every nearer one hides >= 2 px² of target
    const target = { x: 300, y: 200, width: 6, height: 6 };
    const specks = [
      { x: 274, y: 174, width: 1, height: 1 },
      { x: 306, y: 174, width: 1, height: 1 },
      { x: 274, y: 207, width: 1, height: 1 },
      { x: 306, y: 207, width: 1, height: 1 },
    ];
    const box = plan(specks, [], target);
    expect(specks.reduce((n, o) => n + overlapArea(box, o), 0)).toBe(1);
    expect(overlapArea(box, target)).toBe(0);
  });

  it("moves a flush-text target's badge to a clear corner when obstacles sit left and above", () => {
    const obstacles = [LEFT_NEIGHBOUR, ABOVE_NEIGHBOUR];
    // the default box hides neighbour text on both sides
    expect(overlapArea(defaultBox(), LEFT_NEIGHBOUR)).toBeGreaterThan(0);
    expect(overlapArea(defaultBox(), ABOVE_NEIGHBOUR)).toBeGreaterThan(0);
    const box = plan(obstacles);
    expect(box).not.toEqual(defaultBox());
    for (const o of obstacles) expect(overlapArea(box, o)).toBe(0);
    // down-right, as far out as it goes: off the target's own text too
    expect(box).toEqual(anchorBadge(TITLE, "bottom-right", 26, SIZE, IMAGE));
    expect(overlapArea(box, TITLE)).toBe(0);
  });

  it("treats other halos and callouts passed as avoid like obstacles", () => {
    const halo = { x: 84, y: 84, width: 60, height: 40 };
    const box = plan([], [halo]);
    expect(overlapArea(box, halo)).toBe(0);
    expect(box).not.toEqual(defaultBox());
  });

  it("with every corner blocked equally, takes the one that hides the least of the target", () => {
    const wall = { x: 0, y: 0, width: 800, height: 600 };
    const box = plan([wall]);
    expect(overlapArea(box, wall)).toBe(26 * 26);
    expect(overlapArea(box, TITLE)).toBe(0);
  });

  it("prefers the corner that covers less obstacle area", () => {
    // up-left is clipped by a sliver, every other corner is free
    const sliver = { x: 80, y: 80, width: 14, height: 14 };
    const box = plan([sliver, { x: 205, y: 70, width: 40, height: 40 }]);
    expect(overlapArea(box, sliver)).toBe(0);
  });

  it("is deterministic", () => {
    const obstacles = [LEFT_NEIGHBOUR, ABOVE_NEIGHBOUR];
    const first = plan(obstacles);
    for (let i = 0; i < 5; i++) expect(plan(obstacles)).toEqual(first);
    // input order does not matter
    expect(plan([...obstacles].reverse())).toEqual(first);
  });
});
