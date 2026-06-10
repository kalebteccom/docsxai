import { describe, expect, it } from "vitest";
import { placeCallout } from "../src/placement.js";

const image = { width: 1000, height: 800 };
const callout = { width: 200, height: 60 };

describe("placeCallout", () => {
  it("uses the preferred side when it fits", () => {
    const p = placeCallout({
      image,
      target: { x: 400, y: 400, width: 40, height: 20 },
      callout,
      preferred: "top",
    });
    expect(p.side).toBe("top");
    expect(p.callout.y).toBe(400 - 10 - 60); // above the target, gap = 10
    expect(p.arrow.y).toBe(400); // tip at the target's top edge
    // callout horizontally centred on the target, clamped inside the image
    expect(p.callout.x).toBe(420 - 100);
  });

  it("falls off the preferred side when it doesn't fit (target near the top → goes bottom)", () => {
    const p = placeCallout({
      image,
      target: { x: 400, y: 5, width: 40, height: 20 },
      callout,
      preferred: "top",
    });
    expect(p.side).toBe("bottom");
    expect(p.callout.y).toBe(5 + 20 + 10);
    expect(p.arrow.y).toBe(5 + 20);
  });

  it("never lets the callout leave the image (clamped)", () => {
    const p = placeCallout({
      image,
      target: { x: 5, y: 5, width: 10, height: 10 },
      callout: { width: 400, height: 400 },
      preferred: "top",
    });
    expect(p.callout.x).toBeGreaterThanOrEqual(0);
    expect(p.callout.y).toBeGreaterThanOrEqual(0);
    expect(p.callout.x + 400).toBeLessThanOrEqual(image.width);
    expect(p.callout.y + 400).toBeLessThanOrEqual(image.height);
  });

  it("picks the side with the most room when nothing fits", () => {
    const p = placeCallout({
      image,
      target: { x: 10, y: 10, width: 980, height: 600 },
      callout: { width: 400, height: 300 },
      preferred: "top",
    });
    // top room 10, bottom 190, right 10, left 10 → bottom
    expect(p.side).toBe("bottom");
  });

  it("respects a left/right preference", () => {
    const p = placeCallout({
      image,
      target: { x: 600, y: 400, width: 40, height: 20 },
      callout,
      preferred: "right",
    });
    expect(p.side).toBe("right");
    expect(p.callout.x).toBe(600 + 40 + 10);
    expect(p.arrow.x).toBe(600 + 40);
  });
});
