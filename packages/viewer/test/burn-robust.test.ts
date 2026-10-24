import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const ann = (box: unknown, overrides: Partial<AnnotationRecord> = {}): AnnotationRecord =>
  ({
    step: "s1",
    selector: "#x",
    bounding_box: box,
    copy: "Click here",
    ...overrides,
  }) as AnnotationRecord;

describe("burn with out-of-range boxes", () => {
  const cases: Array<[string, unknown]> = [
    ["far outside the image", { x: 500, y: 10, width: 30, height: 20 }],
    ["negative position beyond the edge", { x: -400, y: -400, width: 30, height: 20 }],
    ["zero width", { x: 10, y: 10, width: 0, height: 20 }],
    ["negative height", { x: 10, y: 10, width: 30, height: -5 }],
    ["NaN size", { x: 10, y: 10, width: Number.NaN, height: 20 }],
    ["infinite size", { x: 10, y: 10, width: Infinity, height: 20 }],
  ];
  for (const [name, box] of cases) {
    it(`skips a box ${name} with a warning and a report entry`, async () => {
      const warnings: string[] = [];
      const out = await renderBurn({
        screenshotBuffer: solidPng(160, 120, [255, 255, 255]),
        annotations: [ann(box, { selector: "#bad" })],
        options: { warn: (m) => warnings.push(m) },
      });
      expect(out.png.length).toBeGreaterThan(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"s1"');
      expect(warnings[0]).toContain("#bad");
      expect(out.report).toHaveLength(1);
      expect(out.report[0]).toMatchObject({ selector: "#bad", mode: "none" });
      expect(out.report[0]!.skipped).toMatch(/bounding_box/);
    });
  }

  it("keeps the other annotations of the step", async () => {
    const out = await renderBurn({
      screenshotBuffer: solidPng(160, 120, [255, 255, 255]),
      annotations: [
        ann({ x: 500, y: 10, width: 30, height: 20 }, { selector: "#bad", index: 1 }),
        ann({ x: 20, y: 20, width: 40, height: 20 }, { selector: "#ok", index: 2 }),
      ],
      options: { warn: () => {} },
    });
    expect(out.report.map((r) => r.skipped)).toEqual([expect.any(String), undefined]);
  });

  it("clamps a box that only partly leaves the image", async () => {
    const warnings: string[] = [];
    const out = await renderBurn({
      screenshotBuffer: solidPng(160, 120, [255, 255, 255]),
      annotations: [ann({ x: 140, y: 10, width: 60, height: 20 }, { copy: "" })],
      options: { warn: (m) => warnings.push(m) },
    });
    expect(out.report[0]!.skipped).toBeUndefined();
  });
});

describe("burn tree neighbours of a skipped box", () => {
  it("places the next callout as if the skipped record were absent", async () => {
    const good = ann({ x: 20, y: 20, width: 40, height: 20 }, { selector: "#ok", index: 2 });
    const bad = ann({ x: Number.NaN, y: 0, width: 5, height: 5 }, { selector: "#bad", index: 1 });
    const warn = () => {};
    const alone = await renderBurn({
      screenshotBuffer: solidPng(160, 120, [255, 255, 255]),
      annotations: [good],
      options: { warn },
    });
    const both = await renderBurn({
      screenshotBuffer: solidPng(160, 120, [255, 255, 255]),
      annotations: [bad, good],
      options: { warn },
    });
    expect(both.report[1]).toEqual(alone.report[0]);
  });
});

describe("burn with a non-finite nudge", () => {
  for (const [name, nudge] of [
    ["NaN x", { x: Number.NaN, y: 0 }],
    ["NaN y", { x: 0, y: Number.NaN }],
    ["infinite x", { x: Infinity, y: 0 }],
  ] as const) {
    it(`burns a nudge with ${name} as if that part were 0`, async () => {
      const burn = (extra: Partial<AnnotationRecord>) =>
        renderBurn({
          screenshotBuffer: solidPng(300, 200, [255, 255, 255]),
          annotations: [ann({ x: 100, y: 80, width: 50, height: 30 }, extra)],
          options: { warn: () => {} },
        });
      const out = await burn({ nudge });
      const zero = await burn({
        nudge: {
          x: Number.isFinite(nudge.x) ? nudge.x : 0,
          y: Number.isFinite(nudge.y) ? nudge.y : 0,
        },
      });
      expect(out.report[0]!.skipped).toBeUndefined();
      expect(out.png.equals(zero.png)).toBe(true);
    });
  }
});
