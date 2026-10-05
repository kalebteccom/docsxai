import { describe, expect, it } from "vitest";
import { type BoundingBox } from "../src/doc-pack.js";
import {
  OBSTACLE_LIMIT,
  OBSTACLE_RADIUS,
  selectObstacles,
  type NearbyBoxes,
} from "../src/obstacles.js";

const box = (x: number, y: number, width: number, height: number): BoundingBox => ({
  x,
  y,
  width,
  height,
});
const scanOf = (boxes: BoundingBox[], scale = 1): NearbyBoxes => ({
  image: { width: 1000 * scale, height: 700 * scale },
  scale,
  boxes,
});
const TARGET = box(400, 300, 100, 30);

describe("selectObstacles", () => {
  it("sorts by y, x, width, height", () => {
    const out = selectObstacles(
      scanOf([
        box(600, 340, 50, 10),
        box(100, 340, 50, 10),
        box(100, 340, 40, 20),
        box(300, 260, 50, 10),
      ]),
      TARGET,
    );
    expect(out).toEqual([
      box(300, 260, 50, 10),
      box(100, 340, 40, 20),
      box(100, 340, 50, 10),
      box(600, 340, 50, 10),
    ]);
  });

  it("is independent of the order the driver reports boxes in", () => {
    const boxes = [box(10, 300, 80, 12), box(420, 350, 60, 12), box(420, 250, 60, 12)];
    expect(selectObstacles(scanOf(boxes), TARGET)).toEqual(
      selectObstacles(scanOf([...boxes].reverse()), TARGET),
    );
  });

  it("collapses duplicates into one box", () => {
    const out = selectObstacles(scanOf([box(420, 350, 60, 12), box(420, 350, 60, 12)]), TARGET);
    expect(out).toEqual([box(420, 350, 60, 12)]);
  });

  it("drops a box covered by another kept box (a label inside a button)", () => {
    const out = selectObstacles(scanOf([box(420, 350, 60, 12), box(410, 345, 100, 24)]), TARGET);
    expect(out).toEqual([box(410, 345, 100, 24)]);
  });

  it("drops boxes lying entirely inside the target", () => {
    expect(selectObstacles(scanOf([box(410, 305, 40, 10)]), TARGET)).toEqual([]);
  });

  it("keeps a box that only partly overlaps the target", () => {
    expect(selectObstacles(scanOf([box(480, 305, 60, 10)]), TARGET)).toEqual([
      box(480, 305, 60, 10),
    ]);
  });

  it("drops boxes farther than the radius, keeping those exactly on it", () => {
    const onEdge = box(TARGET.x + TARGET.width + OBSTACLE_RADIUS, 305, 20, 10);
    const beyond = box(TARGET.x + TARGET.width + OBSTACLE_RADIUS + 1, 305, 20, 10);
    expect(selectObstacles(scanOf([onEdge, beyond]), TARGET)).toEqual([onEdge]);
  });

  it("measures the radius diagonally, not per axis", () => {
    // 250 px right and 250 px below the target corner: each axis is inside 320, the distance is 353.
    const corner = box(TARGET.x + TARGET.width + 250, TARGET.y + TARGET.height + 250, 20, 10);
    expect(selectObstacles(scanOf([corner]), TARGET)).toEqual([]);
  });

  it("scales the radius by the device scale factor", () => {
    const target = box(800, 600, 200, 60); // already in 2x screenshot pixels
    const inside = box(1000 + 600, 610, 20, 10); // 600 px = 300 CSS px away
    const outside = box(1000 + 700, 610, 20, 10); // 700 px = 350 CSS px away
    expect(selectObstacles(scanOf([inside, outside], 2), target)).toEqual([inside]);
  });

  it("clips to the image and drops boxes that fall outside it", () => {
    const out = selectObstacles(
      scanOf([
        box(-20, 300, 60, 10),
        box(960, 600, 80, 30),
        box(-50, -50, 20, 20),
        box(1200, 300, 40, 10),
      ]),
      box(20, 320, 60, 20),
      { radius: 2000 },
    );
    expect(out).toEqual([box(0, 300, 40, 10), box(960, 600, 40, 30)]);
  });

  it("rounds fractional boxes outward to whole pixels", () => {
    const out = selectObstacles(scanOf([box(420.4, 350.2, 59.3, 11.5)]), TARGET);
    expect(out).toEqual([box(420, 350, 60, 12)]);
  });

  it("ignores float noise when rounding", () => {
    const out = selectObstacles(scanOf([box(420.0000001, 349.9999999, 60, 12)]), TARGET);
    expect(out).toEqual([box(420, 350, 60, 12)]);
  });

  it("caps at the limit, keeping the boxes nearest the target, then sorts them", () => {
    // 60 boxes in a column below the target: the 40 nearest are the first 40.
    const boxes = Array.from({ length: 60 }, (_, i) => box(420, 340 + i * 5, 40, 3));
    const out = selectObstacles(scanOf(boxes), TARGET, { radius: 5000 });
    expect(out).toHaveLength(OBSTACLE_LIMIT);
    expect(out[0]).toEqual(box(420, 340, 40, 3));
    expect(out.at(-1)).toEqual(box(420, 340 + 39 * 5, 40, 3));
    expect(out.map((b) => b.y)).toEqual([...out.map((b) => b.y)].sort((a, b) => a - b));
  });

  it("honours custom radius and limit", () => {
    const boxes = [box(420, 340, 40, 10), box(420, 380, 40, 10), box(420, 420, 40, 10)];
    expect(selectObstacles(scanOf(boxes), TARGET, { limit: 2 })).toEqual(boxes.slice(0, 2));
    expect(selectObstacles(scanOf(boxes), TARGET, { radius: 60 })).toEqual(boxes.slice(0, 2));
  });

  it("returns an empty array when nothing qualifies", () => {
    expect(selectObstacles(scanOf([]), TARGET)).toEqual([]);
  });
});
