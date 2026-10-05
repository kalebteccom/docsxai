import { describe, expect, it } from "vitest";
import { overlapArea, planCallout, slideStarts } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";

const image = { width: 1000, height: 800 };
const callout = { width: 200, height: 60 };
const target: Rect = { x: 400, y: 300, width: 160, height: 40 };
const base = { image, target, callout, obstacles: [] as Rect[] };

describe("planCallout strictSide", () => {
  const above = { x: 380, y: 200, width: 220, height: 90 };

  it("keeps the preferred side even when another side would be cheaper", () => {
    const loose = planCallout({ ...base, obstacles: [above], preferred: "top" });
    const strict = planCallout({ ...base, obstacles: [above], preferred: "top", strictSide: true });
    expect(loose.side).not.toBe("top");
    expect(strict.side).toBe("top");
  });

  it("falls back to the other sides when the preferred side has no spot in the image", () => {
    const edge = {
      ...base,
      target: { x: 400, y: 20, width: 160, height: 40 },
      preferred: "top" as const,
    };
    const p = planCallout({ ...edge, strictSide: true });
    expect(p.side).not.toBe("top");
  });

  it("changes nothing when it is off", () => {
    expect(planCallout({ ...base, preferred: "left" })).toEqual(
      planCallout({ ...base, preferred: "left", strictSide: false }),
    );
  });
});

describe("planCallout align", () => {
  const left = (p: ReturnType<typeof planCallout>) => p.callout.x;

  it("rests flush with the target's start or end, centred by default", () => {
    const centred = planCallout({ ...base, preferred: "top" });
    const start = planCallout({ ...base, preferred: "top", align: "start" });
    const end = planCallout({ ...base, preferred: "top", align: "end" });
    expect(left(centred)).toBe(target.x + target.width / 2 - callout.width / 2);
    expect(left(start)).toBe(target.x);
    expect(left(end)).toBe(target.x + target.width - callout.width);
    expect(planCallout({ ...base, preferred: "top", align: "center" })).toEqual(centred);
  });

  it("works along the vertical edge for left and right", () => {
    const start = planCallout({ ...base, preferred: "right", align: "start" });
    const end = planCallout({ ...base, preferred: "right", align: "end" });
    expect(start.callout.y).toBe(target.y);
    expect(end.callout.y).toBe(target.y + target.height - callout.height);
  });
});

describe("planCallout pinArrow", () => {
  const nudge = { x: 40, y: -30 };

  it("keeps the arrow on the target while the callout moves", () => {
    const plain = planCallout({ ...base, preferred: "top" });
    const pinned = planCallout({ ...base, preferred: "top", nudge, pinArrow: true });
    expect(pinned.side).toBe("top");
    expect(pinned.arrow.y).toBe(target.y);
    expect(pinned.arrow.x).toBeGreaterThanOrEqual(target.x);
    expect(pinned.arrow.x).toBeLessThanOrEqual(target.x + target.width);
    expect(pinned.nudgeBaked).toBe(true);
    // moved up by 30 across the edge, slid right along it
    expect(pinned.callout.y).toBeLessThan(plain.callout.y);
    expect(pinned.callout.x).toBeGreaterThan(plain.callout.x);
    expect(pinned.stem).not.toBeNull();
  });

  it("joins the moved callout to the arrow with a stem that reaches both", () => {
    const p = planCallout({ ...base, preferred: "top", nudge: { x: 0, y: -50 }, pinArrow: true });
    const stem = p.stem!;
    expect(stem.y + stem.height).toBeGreaterThanOrEqual(target.y - 8 - 1);
    expect(stem.y).toBeLessThanOrEqual(p.callout.y + callout.height);
  });

  it("is the plain placement when the nudge is zero", () => {
    const plain = planCallout({ ...base, preferred: "bottom" });
    const pinned = planCallout({ ...base, preferred: "bottom", pinArrow: true });
    expect({ ...pinned, nudgeBaked: undefined }).toEqual({ ...plain, nudgeBaked: undefined });
  });

  it("scores the callout where the nudge puts it, and steers clear of content there", () => {
    const text = { x: 450, y: 180, width: 150, height: 40 };
    const p = planCallout({
      ...base,
      obstacles: [text],
      preferred: "top",
      nudge: { x: 0, y: -40 },
      pinArrow: true,
    });
    const placed = { x: p.callout.x, y: p.callout.y, ...callout };
    expect(p.overlap).toBe(0);
    expect(overlapArea(placed, text)).toBe(0);
  });

  it("without pinArrow the nudge is left to the renderer", () => {
    expect(planCallout({ ...base, nudge }).nudgeBaked).toBeUndefined();
  });

  it("is deterministic", () => {
    const input = { ...base, preferred: "right" as const, nudge, pinArrow: true };
    expect(planCallout(input)).toEqual(planCallout(input));
  });
});

describe("slideStarts step cap", () => {
  // inset 6 and margin 10 leave a slide range of length - 16 for a 100 px callout
  const range = (length: number) => slideStarts({ from: 0, length }, 100, 10 ** 7);

  it("keeps the 8 px steps up to a 1600 px range", () => {
    const { starts, lo, hi } = range(1616);
    expect(hi - lo).toBe(1600);
    const centred = starts[0]!;
    const expected = new Set<number>([centred, lo, hi]);
    for (let s = 8; centred - s >= lo || centred + s <= hi; s += 8) {
      if (centred - s >= lo) expected.add(centred - s);
      if (centred + s <= hi) expected.add(centred + s);
    }
    expect(starts).toEqual(
      [...expected].sort((a, b) => Math.abs(a - centred) - Math.abs(b - centred) || a - b),
    );
  });

  it("coarsens the step only past that, and stays bounded on an absurd range", () => {
    const { starts, lo, hi } = range(100016);
    expect(hi - lo).toBe(100000);
    expect(starts.length).toBeLessThanOrEqual(205);
    expect(starts).toContain(lo);
    expect(starts).toContain(hi);
  });
});
