import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, renderBurn, type BurnNode } from "../src/burn.js";
import { measureCallout } from "../src/burn-callout.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { overlapArea, planCallout } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

// A 390 px phone screenshot of a dense list page: a header band, a column of text rows hugging the
// left edge, a footer band. The only free ground is a 210 px strip on the right, where two icon
// targets sit. A 280 px callout fits nowhere on this page.
const IMAGE = { width: 390, height: 844 };
const ROWS: Rect[] = Array.from({ length: 13 }, (_, i) => ({
  x: 16,
  y: 200 + 30 * i,
  width: 164,
  height: 22,
}));
const OBSTACLES: Rect[] = [
  { x: 0, y: 0, width: 390, height: 190 },
  ...ROWS,
  { x: 0, y: 612, width: 390, height: 232 },
];
const TARGETS: Rect[] = [
  { x: 330, y: 300, width: 30, height: 24 },
  { x: 330, y: 500, width: 30, height: 24 },
];
const COPY = [
  "Tasks an agent is working on right now sit in In progress, so you can see what moves.",
  "The status pill shows where the task stands and who is on it.",
];

const annotations = (): AnnotationRecord[] =>
  TARGETS.map((bounding_box, i) => ({
    step: "board",
    selector: `#t${i + 1}`,
    bounding_box,
    copy: COPY[i]!,
    index: i + 1,
    obstacles: OBSTACLES,
  }));

const nodesOf = (t: BurnNode) => (t.props.children as BurnNode[]).slice(1);
const calloutBoxes = (t: BurnNode): Rect[] =>
  nodesOf(t)
    .filter((n) => n.props.style!.backgroundColor === "#fff")
    .map((n) => ({
      x: n.props.style!.left as number,
      y: n.props.style!.top as number,
      width: n.props.style!.width as number,
      height: n.props.style!.height as number,
    }));

describe("burn on a 390 px screenshot with a dense layout", () => {
  const report: AnnotationReport[] = [];
  const tree = buildBurnTree({
    image: { ...IMAGE, dataUri: "data:image/png;base64,AAAA" },
    annotations: annotations(),
    metrics: METRICS,
    report,
  });

  it("has no clear spot for a 280 px callout", () => {
    const wide = measureCallout(`1. ${COPY[0]}`, METRICS, 280).size;
    const p = planCallout({
      image: IMAGE,
      target: TARGETS[0]!,
      callout: wide,
      obstacles: OBSTACLES,
    });
    expect(p.overlap).toBeGreaterThan(0);
  });

  it("narrows each callout until it sits in the free strip, off every obstacle", () => {
    const boxes = calloutBoxes(tree);
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.width).toBeLessThan(242);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(IMAGE.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(IMAGE.height);
      for (const o of OBSTACLES) expect(overlapArea(box, o)).toBe(0);
    }
  });

  it("keeps the callouts off both halos and each other", () => {
    const [a, b] = calloutBoxes(tree) as [Rect, Rect];
    expect(overlapArea(a, b)).toBe(0);
    for (const target of TARGETS) {
      expect(overlapArea(a, target)).toBe(0);
      expect(overlapArea(b, target)).toBe(0);
    }
  });

  it("reports both as placed: no overlap with obstacles, not unplaceable", () => {
    expect(report).toHaveLength(2);
    for (const r of report) {
      expect(r.obstacle_overlap).toBe(0);
      expect(r.unplaceable).toBe(false);
      expect(r.callout!.width).toBeLessThan(242);
    }
  });

  it("burns to a 390 px PNG with the callout in the strip, and the same bytes every time", async () => {
    const shot = solidPng(IMAGE.width, IMAGE.height);
    const a = await renderBurn({ screenshotBuffer: shot, annotations: annotations() });
    const b = await renderBurn({ screenshotBuffer: shot, annotations: annotations() });
    expect(a.png.equals(b.png)).toBe(true);
    const img = decodePng(a.png);
    expect(img.width).toBe(390);
    // white callout fill inside the first callout's box, page background outside any overlay
    const box = a.report[0]!.callout!;
    const [r, g, bl] = pixelAt(img, box.x + box.width / 2, box.y + box.height - 4);
    expect([r, g, bl]).toEqual([255, 255, 255]);
    expect(pixelAt(img, 5, 400)).toEqual(pixelAt(img, 385, 760));
  });
});
