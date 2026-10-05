import { describe, expect, it } from "vitest";
import { placeCallout, type Rect } from "../src/placement.js";
import { overlapArea, planCallout, scorePlacement } from "../src/obstacle-placement.js";
import { arrowGeometry } from "../src/arrow.js";

const image = { width: 1000, height: 800 };
const callout = { width: 200, height: 60 };
const NO_BOUNDS = { image, obstacles: [] as Rect[], avoid: [] as Rect[] };

function calloutRect(p: ReturnType<typeof planCallout>): Rect {
  return { x: p.callout.x, y: p.callout.y, ...callout };
}
function connectorOf(p: ReturnType<typeof planCallout>): Rect[] {
  const a = arrowGeometry(p.side, p.arrow);
  return [{ x: a.left, y: a.top, width: a.width, height: a.height }, ...(p.stem ? [p.stem] : [])];
}
const covered = (rects: Rect[], obstacles: Rect[]) =>
  rects.reduce((sum, r) => sum + obstacles.reduce((s, o) => s + overlapArea(r, o), 0), 0);

describe("overlapArea", () => {
  it("is the intersection area, 0 when apart or only touching", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlapArea(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(25);
    expect(overlapArea(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(0);
    expect(overlapArea(a, { x: 50, y: 50, width: 5, height: 5 })).toBe(0);
    expect(overlapArea(a, { x: 2, y: 2, width: 3, height: 3 })).toBe(9);
  });
});

describe("scorePlacement", () => {
  const boxes = {
    callout: { x: 100, y: 100, width: 100, height: 40 },
    connector: [{ x: 140, y: 140, width: 2, height: 20 }],
  };

  it("scores a clear placement 0", () => {
    expect(scorePlacement(boxes, NO_BOUNDS)).toEqual({ cost: 0, overlap: 0 });
  });

  it("charges content overlap, and more than clearance-only contact", () => {
    const text = { x: 150, y: 120, width: 100, height: 10 };
    const hit = scorePlacement(boxes, { ...NO_BOUNDS, obstacles: [text] });
    expect(hit.overlap).toBe(500); // 50 x 10 inside the callout
    const near = { x: 150, y: 143, width: 100, height: 10 }; // 3px below the callout: clearance only
    const graze = scorePlacement(boxes, { ...NO_BOUNDS, obstacles: [near] });
    expect(graze.overlap).toBe(0);
    expect(graze.cost).toBeGreaterThan(0);
    expect(graze.cost).toBeLessThan(hit.cost);
  });

  it("charges the stem when it crosses an obstacle", () => {
    const crossing = { x: 120, y: 150, width: 60, height: 5 };
    const r = scorePlacement(boxes, { ...NO_BOUNDS, obstacles: [crossing] });
    expect(r.overlap).toBe(2 * 5);
    expect(r.cost).toBeGreaterThan(0);
  });

  it("charges avoided boxes (halos, badges, earlier callouts) like content", () => {
    const halo = { x: 100, y: 100, width: 20, height: 20 };
    const r = scorePlacement(boxes, { ...NO_BOUNDS, avoid: [halo] });
    expect(r.overlap).toBe(400);
    expect(r.cost).toBeGreaterThan(0);
  });

  it("charges the part of the callout outside the image", () => {
    const out = {
      callout: { x: -20, y: 10, width: 100, height: 40 },
      connector: [],
    };
    const r = scorePlacement(out, NO_BOUNDS);
    expect(r.cost).toBeGreaterThan(0);
    expect(r.overlap).toBe(0); // outside the image is not content overlap
  });
});

describe("planCallout, narrow target beside text", () => {
  // A 30px-wide button between two text columns that span y 200..400. Free space only above y=190
  // and below y=410, reachable by a stem through the 50px gap between the columns.
  const target = { x: 500, y: 300, width: 30, height: 20 };
  const columns: Rect[] = [
    { x: 100, y: 200, width: 390, height: 200 },
    { x: 540, y: 200, width: 360, height: 200 },
  ];

  it("adjacent placement (today's) lands on the text", () => {
    const legacy = placeCallout({ image, target, callout, preferred: "top" });
    const rect = { x: legacy.callout.x, y: legacy.callout.y, ...callout };
    expect(covered([rect], columns)).toBeGreaterThan(0);
  });

  it("sits further away in clear space with a longer arrow", () => {
    const p = planCallout({ image, target, callout, preferred: "top", obstacles: columns });
    expect(p.overlap).toBe(0);
    expect(covered([calloutRect(p), ...connectorOf(p)], columns)).toBe(0);
    expect(p.distance).toBeGreaterThan(10 + 60); // had to clear the 100px-tall columns above
    // arrow tip still on the target's edge
    expect(p.arrow.x).toBeGreaterThanOrEqual(target.x);
    expect(p.arrow.x).toBeLessThanOrEqual(target.x + target.width);
    expect([target.y, target.y + target.height]).toContain(p.arrow.y);
  });

  it("keeps the preferred side when it has clear space", () => {
    const p = planCallout({ image, target, callout, preferred: "bottom", obstacles: columns });
    expect(p.side).toBe("bottom");
    expect(p.callout.y).toBeGreaterThan(target.y + target.height);
    expect(p.overlap).toBe(0);
  });

  it("slides along the edge to dodge a block that only covers one side", () => {
    const wide = { x: 400, y: 300, width: 40, height: 20 };
    const block = { x: 250, y: 220, width: 160, height: 60 }; // above-left of the target
    const p = planCallout({ image, target: wide, callout, preferred: "top", obstacles: [block] });
    expect(p.overlap).toBe(0);
    expect(p.distance).toBe(10); // adjacent, just slid right
    expect(p.callout.x).toBeGreaterThan(400 - 100);
    expect(p.arrow.x).toBeGreaterThanOrEqual(wide.x);
    expect(p.arrow.x).toBeLessThanOrEqual(wide.x + wide.width);
  });
});

describe("planCallout, no free space", () => {
  const target = { x: 480, y: 380, width: 40, height: 20 };
  // The page is covered edge to edge except the target, and, in `withPocket`, a 150x60 pocket left of it.
  const around: Rect[] = [
    { x: 0, y: 0, width: 1000, height: 368 }, // above
    { x: 0, y: 428, width: 1000, height: 372 }, // below
    { x: 480, y: 368, width: 40, height: 12 }, // over the target
    { x: 480, y: 400, width: 40, height: 28 }, // under the target
    { x: 520, y: 368, width: 480, height: 60 }, // right of it
  ];
  const withoutPocket = [...around, { x: 0, y: 368, width: 480, height: 60 }];
  const withPocket = [...around, { x: 0, y: 368, width: 330, height: 60 }];

  it("falls back to the preferred side, next to the target, when everything is covered", () => {
    const p = planCallout({ image, target, callout, preferred: "right", obstacles: withoutPocket });
    expect(p.overlap).toBeGreaterThan(0);
    expect(p.side).toBe("right");
    expect(p.distance).toBe(10);
  });

  it("takes the least-overlapping spot when nothing is clear", () => {
    const p = planCallout({ image, target, callout, preferred: "top", obstacles: withPocket });
    expect(p.side).toBe("left");
    expect(p.callout).toEqual({ x: 270, y: 368 }); // the pocket's 140px, 60px of text covered
    expect(p.overlap).toBe(60 * 60);
    const stuck = planCallout({
      image,
      target,
      callout,
      preferred: "top",
      obstacles: withoutPocket,
    });
    expect(p.overlap).toBeLessThan(stuck.overlap);
  });

  it("keeps the callout on-screen", () => {
    for (const preferred of ["top", "bottom", "left", "right"] as const) {
      const p = planCallout({ image, target, callout, preferred, obstacles: withoutPocket });
      expect(p.callout.x).toBeGreaterThanOrEqual(0);
      expect(p.callout.y).toBeGreaterThanOrEqual(0);
      expect(p.callout.x + callout.width).toBeLessThanOrEqual(image.width);
      expect(p.callout.y + callout.height).toBeLessThanOrEqual(image.height);
    }
  });

  it("returns today's clamped placement when no candidate fits the image at all", () => {
    const big = { width: 900, height: 700 };
    const input = {
      image,
      target: { x: 50, y: 50, width: 900, height: 700 },
      callout: big,
      preferred: "top" as const,
    };
    const p = planCallout({ ...input, obstacles: [{ x: 0, y: 0, width: 10, height: 10 }] });
    const legacy = placeCallout(input);
    expect(p.side).toBe(legacy.side);
    expect(p.callout).toEqual(legacy.callout);
    expect(p.arrow).toEqual(legacy.arrow);
  });
});

describe("planCallout, avoid + nudge", () => {
  const target = { x: 400, y: 400, width: 40, height: 20 };

  it("keeps clear of avoided boxes such as a neighbouring halo and earlier callouts", () => {
    const earlier = { x: 320, y: 330, width: 200, height: 60 }; // exactly where `top` would go
    const p = planCallout({
      image,
      target,
      callout,
      preferred: "top",
      obstacles: [{ x: 0, y: 0, width: 1, height: 1 }],
      avoid: [earlier],
    });
    expect(overlapArea(calloutRect(p), earlier)).toBe(0);
    expect(covered(connectorOf(p), [earlier])).toBe(0);
  });

  it("scores candidates at their nudged position", () => {
    const text = { x: 0, y: 200, width: 1000, height: 100 };
    const base = planCallout({ image, target, callout, preferred: "top", obstacles: [text] });
    const nudged = planCallout({
      image,
      target,
      callout,
      preferred: "top",
      obstacles: [text],
      nudge: { x: 0, y: -50 },
    });
    expect(base.overlap).toBe(0);
    // the nudge would push a `top` callout into the text, so the planner moves elsewhere
    const rect = { ...calloutRect(nudged), y: nudged.callout.y - 50 };
    expect(overlapArea(rect, text)).toBe(0);
  });
});

describe("planCallout, determinism", () => {
  it("returns the same placement for the same input, and prefers earlier sides on exact ties", () => {
    const input = {
      image,
      target: { x: 500, y: 300, width: 30, height: 20 },
      callout,
      preferred: "right" as const,
      obstacles: [
        { x: 100, y: 200, width: 390, height: 200 },
        { x: 540, y: 200, width: 360, height: 200 },
      ],
    };
    const a = planCallout(input);
    const b = planCallout({ ...input, obstacles: [...input.obstacles] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const symmetric = planCallout({
      image,
      target: { x: 480, y: 380, width: 40, height: 40 },
      callout: { width: 100, height: 100 },
      preferred: "left",
      obstacles: [{ x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(symmetric.side).toBe("left"); // nothing to dodge: preferred side wins the tie
  });
});
