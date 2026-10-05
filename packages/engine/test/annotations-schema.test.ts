// `docsxai/annotations@1` stays additive: `obstacles` is optional, files without it still parse.

import { describe, expect, it } from "vitest";
import {
  AnnotationsFile,
  FlowFile,
  MAX_CALLOUT_WIDTH,
  MAX_OBSTACLES,
  MAX_OBSTACLE_RADIUS,
  MIN_CALLOUT_WIDTH,
} from "../src/doc-pack.js";

const record = { step: "open", selector: "#play", copy: "Click Play" };
const file = (annotations: unknown[]) => ({
  schema: "docsxai/annotations@1",
  flow: "demo",
  annotations,
});

describe("AnnotationRecord.obstacles", () => {
  it("accepts records written before the field existed", () => {
    expect(AnnotationsFile.safeParse(file([record])).success).toBe(true);
  });

  it("accepts an array of boxes, empty included", () => {
    const boxes = [{ x: 1, y: 2, width: 30, height: 4 }];
    const parsed = AnnotationsFile.parse(file([{ ...record, obstacles: boxes }]));
    expect(parsed.annotations[0]?.obstacles).toEqual(boxes);
    expect(AnnotationsFile.safeParse(file([{ ...record, obstacles: [] }])).success).toBe(true);
  });

  it("rejects malformed boxes and still rejects unknown keys", () => {
    expect(AnnotationsFile.safeParse(file([{ ...record, obstacles: [{ x: 1 }] }])).success).toBe(
      false,
    );
    expect(AnnotationsFile.safeParse(file([{ ...record, obstacle: [] }])).success).toBe(false);
  });

  it("caps the list at MAX_OBSTACLES and rejects negative or non-finite sizes", () => {
    const box = { x: 0, y: 0, width: 5, height: 5 };
    const many = (n: number) => Array.from({ length: n }, () => box);
    const ok = (obstacles: unknown[]) =>
      AnnotationsFile.safeParse(file([{ ...record, obstacles }])).success;
    expect(ok(many(MAX_OBSTACLES))).toBe(true);
    expect(ok(many(MAX_OBSTACLES + 1))).toBe(false);
    expect(ok([{ ...box, width: -1 }])).toBe(false);
    expect(ok([{ ...box, height: Number.POSITIVE_INFINITY }])).toBe(false);
    expect(ok([{ ...box, x: Number.NaN }])).toBe(false);
    expect(ok([{ ...box, x: -3 }])).toBe(true); // position may be off the image; selection clips it
  });

  it("holds bounding_box to the same shape", () => {
    const bad = { ...record, bounding_box: { x: 0, y: 0, width: -1, height: 5 } };
    expect(AnnotationsFile.safeParse(file([bad])).success).toBe(false);
  });
});

describe("AnnotationRecord.placement", () => {
  const withPlacement = (placement: unknown) =>
    AnnotationsFile.safeParse(file([{ ...record, placement }])).success;

  it("accepts records written before the field existed, and an empty object", () => {
    expect(AnnotationsFile.safeParse(file([record])).success).toBe(true);
    expect(withPlacement({})).toBe(true);
  });

  it("accepts every documented key", () => {
    expect(
      withPlacement({
        inside: true,
        side: "left",
        align: "end",
        pin_arrow: true,
        max_width: 200,
        obstacle_radius: 120,
        obstacle_limit: 10,
      }),
    ).toBe(true);
  });

  it("rejects unknown keys and bad enum values", () => {
    expect(withPlacement({ outside: true })).toBe(false);
    expect(withPlacement({ side: "top-left" })).toBe(false);
    expect(withPlacement({ align: "middle" })).toBe(false);
    expect(withPlacement({ inside: "yes" })).toBe(false);
  });

  it("bounds the numbers and rejects non-finite ones", () => {
    expect(withPlacement({ max_width: MIN_CALLOUT_WIDTH })).toBe(true);
    expect(withPlacement({ max_width: MAX_CALLOUT_WIDTH })).toBe(true);
    expect(withPlacement({ max_width: MIN_CALLOUT_WIDTH - 1 })).toBe(false);
    expect(withPlacement({ max_width: MAX_CALLOUT_WIDTH + 1 })).toBe(false);
    expect(withPlacement({ max_width: Number.NaN })).toBe(false);
    expect(withPlacement({ obstacle_radius: 0 })).toBe(true);
    expect(withPlacement({ obstacle_radius: MAX_OBSTACLE_RADIUS })).toBe(true);
    expect(withPlacement({ obstacle_radius: -1 })).toBe(false);
    expect(withPlacement({ obstacle_radius: MAX_OBSTACLE_RADIUS + 1 })).toBe(false);
    expect(withPlacement({ obstacle_radius: Number.POSITIVE_INFINITY })).toBe(false);
    expect(withPlacement({ obstacle_limit: 1 })).toBe(true);
    expect(withPlacement({ obstacle_limit: MAX_OBSTACLES })).toBe(true);
    expect(withPlacement({ obstacle_limit: 0 })).toBe(false);
    expect(withPlacement({ obstacle_limit: MAX_OBSTACLES + 1 })).toBe(false);
    expect(withPlacement({ obstacle_limit: 2.5 })).toBe(false);
  });

  it("is accepted on a flow-file step annotation and held to the same bounds", () => {
    const flow = (placement: unknown) =>
      FlowFile.safeParse({
        name: "f",
        steps: [{ id: "a", action: "click", target: "#x", annotation: { copy: "c", placement } }],
      }).success;
    expect(flow({ inside: true, obstacle_radius: 200 })).toBe(true);
    expect(flow({ obstacle_limit: 0 })).toBe(false);
  });
});
