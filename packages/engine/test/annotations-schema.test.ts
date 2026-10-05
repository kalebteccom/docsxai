// `docsxai/annotations@1` stays additive: `obstacles` is optional, files without it still parse.

import { describe, expect, it } from "vitest";
import { AnnotationsFile } from "../src/doc-pack.js";

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
});
