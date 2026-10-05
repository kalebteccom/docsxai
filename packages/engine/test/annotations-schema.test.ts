// `docsxai/annotations@1` stays additive: `obstacles` is optional, files without it still parse.

import { describe, expect, it } from "vitest";
import { AnnotationsFile, MAX_OBSTACLES } from "../src/doc-pack.js";

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
