import { describe, expect, it } from "vitest";
import { hintBonus, planCallout, type PlanInput } from "../src/obstacle-placement.js";

// A short label beside a select on a 390 px phone screen, hinted to go on top, where the select one
// row up sits.
const base: PlanInput = {
  image: { width: 390, height: 780 },
  target: { x: 287, y: 162, width: 87, height: 44 },
  callout: { width: 60, height: 37 },
  preferred: "top",
  gap: 10,
  obstacles: [{ x: 285, y: 93, width: 89, height: 42 }],
  hinted: true,
};

describe("hintBonus", () => {
  it("is the full bonus for a callout 200 px wide or more, a 2 px strip of content below that", () => {
    expect(hintBonus(280)).toBe(4000);
    expect(hintBonus(200)).toBe(4000);
    expect(hintBonus(60)).toBe(1200);
  });

  it("still lets a short label keep its hinted side over a 1 px sliver", () => {
    const sliver = [{ x: 0, y: 100, width: 390, height: 16 }]; // ends 1 px into the top spot
    const p = planCallout({ ...base, obstacles: sliver });
    expect(p.side).toBe("top");
    expect(p.overlap).toBeGreaterThan(0);
  });
});

describe("a hint on a short callout", () => {
  it("loses to a neighbouring control the top spot would cover", () => {
    const p = planCallout(base);
    expect(p.side).not.toBe("top");
    expect(p.overlap).toBe(0);
  });
});
