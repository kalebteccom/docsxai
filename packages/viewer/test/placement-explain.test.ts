import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, type CalloutTrace } from "../src/burn.js";
import { explainLayout, layoutCallout, type LayoutInput } from "../src/burn-callout.js";
import { planCallout, sideVerdicts, type PlanInput } from "../src/obstacle-placement.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { DEFAULT_BURN_THEME } from "../src/burn-theme.js";
import type { AnnotationRecord } from "../src/annotations.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

// A 390 px phone screen: a select on the right of a settings row, the row above it holds another
// select, the row's label and description sit to its left. Room is below the target and to the
// left only above the description.
const IMAGE = { width: 390, height: 780 };
const TARGET = { x: 287, y: 162, width: 87, height: 44 };
const OBSTACLES = [
  { x: 285, y: 93, width: 89, height: 42 }, // the select one row up
  { x: 16, y: 166, width: 40, height: 20 }, // row label
  { x: 16, y: 188, width: 200, height: 16 }, // row description
  { x: 16, y: 226, width: 120, height: 20 }, // next row label
];

const base: PlanInput = {
  image: IMAGE,
  target: TARGET,
  callout: { width: 60, height: 37 },
  preferred: "top",
  gap: 10,
  obstacles: OBSTACLES,
  hinted: true,
};

describe("sideVerdicts", () => {
  it("lists every side, the preferred one first, and agrees with planCallout's pick", () => {
    const verdicts = sideVerdicts(base);
    expect(verdicts.map((v) => v.side)).toEqual(["top", "bottom", "right", "left"]);
    const scored = verdicts.filter((v) => v.cost !== null);
    const cheapest = scored.reduce((a, b) => (b.cost! < a.cost! ? b : a));
    expect(planCallout(base).side).toBe(cheapest.side);
  });

  it("shows why a top hint loses here: the top spot covers the select above", () => {
    const top = sideVerdicts(base).find((v) => v.side === "top")!;
    expect(top.overlap).toBeGreaterThan(0);
    expect(planCallout(base).side).not.toBe("top");
  });

  it("gives no cost to a side without room in the image", () => {
    const right = sideVerdicts(base).find((v) => v.side === "right")!;
    expect(right.cost).toBeNull();
  });
});

describe("explainLayout", () => {
  const ann = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
    step: "appearance",
    selector: "#theme",
    bounding_box: TARGET,
    copy: "Tema",
    obstacles: OBSTACLES,
    arrow_style: "top",
    ...overrides,
  });
  const input = (a: AnnotationRecord): LayoutInput => ({
    ann: a,
    target: a.bounding_box!,
    image: IMAGE,
    metrics: METRICS,
    clear: [],
  });

  it("scores the box the layout ended with, and its pick matches the layout's side", () => {
    const inp = input(ann());
    const layout = layoutCallout(inp);
    const verdicts = explainLayout(inp, layout);
    const cheapest = verdicts
      .filter((v) => v.cost !== null)
      .reduce((a, b) => (b.cost! < a.cost! ? b : a));
    expect(cheapest.side).toBe(layout.side);
  });

  it("is empty when nothing was scored", () => {
    const inp = input(ann({ obstacles: undefined, arrow_style: undefined }));
    expect(explainLayout(inp, layoutCallout(inp))).toEqual([]);
  });

  it("is what buildBurnTree traced, at base size", () => {
    const trace: CalloutTrace[] = [];
    buildBurnTree({
      image: { ...IMAGE, dataUri: "data:image/png;base64,AAAA" },
      annotations: [ann()],
      metrics: METRICS,
      theme: { ...DEFAULT_BURN_THEME, scale: 2 },
      trace,
    });
    expect(trace).toHaveLength(1);
    expect(trace[0]!.scale).toBe(2);
    expect(trace[0]!.input.image).toEqual({ width: 195, height: 390 });
    expect(trace[0]!.input.target).toEqual({ x: 143.5, y: 81, width: 43.5, height: 22 });
    expect(explainLayout(trace[0]!.input, trace[0]!.layout)).toHaveLength(4);
  });
});
