import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBurnTree,
  burnAnnotations,
  burnFlow,
  burnReport,
  renderBurn,
  type BurnNode,
} from "../src/burn.js";
import { BURN_REPORT_SCHEMA, DEFAULT_UNPLACEABLE_RATIO } from "../src/burn-report.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { runViewerCli } from "../src/index.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const IMAGE = { width: 800, height: 600, dataUri: "data:image/png;base64,AAAA" };

const annotation = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "toolbar",
  selector: "#play",
  bounding_box: { x: 400, y: 300, width: 30, height: 20 },
  copy: "Click Play to open the recap sidebar",
  ...overrides,
});

function reportFor(anns: AnnotationRecord[], unplaceableRatio?: number) {
  const report: AnnotationReport[] = [];
  const tree = buildBurnTree({
    image: IMAGE,
    annotations: anns,
    metrics: METRICS,
    report,
    ...(unplaceableRatio !== undefined ? { unplaceableRatio } : {}),
  });
  return { report, tree };
}
const calloutCount = (t: BurnNode) =>
  (t.props.children as BurnNode[]).filter((n) => n.props.style?.backgroundColor === "#fff").length;

// Free space only above and below the button, between two text columns.
const COLUMNS = [
  { x: 60, y: 200, width: 330, height: 200 },
  { x: 440, y: 200, width: 300, height: 200 },
];
// The whole screenshot is page content: nowhere to put a callout.
const WALL = [{ x: 0, y: 0, width: 800, height: 600 }];

describe("burn report", () => {
  it("lists each annotation's callout box, badge box and overlaps", () => {
    const { report } = reportFor([annotation({ obstacles: COLUMNS, index: 1 })]);
    const [r] = report;
    expect(report).toHaveLength(1);
    expect(r).toMatchObject({
      step: "toolbar",
      index: 1,
      selector: "#play",
      mode: "outside",
      obstacle_overlap: 0,
      unplaceable: false,
    });
    expect(r!.overlap_ratio).toBeLessThan(DEFAULT_UNPLACEABLE_RATIO);
    expect(r!.side).toMatch(/^(top|bottom|left|right)$/);
    expect(r!.callout!.width).toBeGreaterThan(0);
    expect(r!.badge).not.toBeNull();
    expect(r).not.toHaveProperty("skipped");
  });

  it("reports the area still covering page content", () => {
    const text = { x: 380, y: 240, width: 60, height: 50 };
    const { report } = reportFor([annotation({ obstacles: [text, ...COLUMNS] })]);
    expect(report[0]!.obstacle_overlap).toBeGreaterThanOrEqual(0);
    const wall = reportFor([annotation({ obstacles: WALL })]).report[0]!;
    const box = wall.callout!;
    expect(wall.obstacle_overlap).toBeGreaterThanOrEqual(Math.round(box.width * box.height));
  });

  it("flags unplaceable when the best spot still covers more than the threshold, and draws it anyway", () => {
    const { report, tree } = reportFor([annotation({ obstacles: WALL, index: 1 })]);
    expect(report[0]!.unplaceable).toBe(true);
    expect(report[0]!.overlap_ratio).toBeGreaterThan(DEFAULT_UNPLACEABLE_RATIO);
    expect(calloutCount(tree)).toBe(1); // never dropped
  });

  it("does not flag a placement that grazes content under the threshold", () => {
    const line = { x: 395, y: 262, width: 40, height: 3 }; // a sliver over any callout above
    const { report } = reportFor([annotation({ obstacles: [line, ...COLUMNS] })]);
    expect(report[0]!.unplaceable).toBe(false);
  });

  it("takes the threshold from the option", () => {
    const strict = reportFor([annotation({ obstacles: WALL })], 5).report[0]!;
    expect(strict.overlap_ratio).toBeLessThanOrEqual(5);
    expect(strict.unplaceable).toBe(false);
    expect(reportFor([annotation({ obstacles: WALL })], 0).report[0]!.unplaceable).toBe(true);
  });

  it("charges earlier callouts, not just page content", () => {
    // a 130 x 60 screenshot has no room for two callouts: the second lands on the first
    const tiny = { width: 130, height: 60, dataUri: IMAGE.dataUri };
    const speck = [{ x: 0, y: 0, width: 2, height: 2 }];
    const target = { x: 55, y: 25, width: 20, height: 10 };
    const report: AnnotationReport[] = [];
    buildBurnTree({
      image: tiny,
      metrics: METRICS,
      report,
      annotations: [
        annotation({ bounding_box: target, copy: "First", index: 1, obstacles: speck }),
        annotation({ bounding_box: target, copy: "Second", index: 2, obstacles: speck }),
      ],
    });
    expect(report[1]!.other_overlap).toBeGreaterThan(0);
    expect(report[1]!.obstacle_overlap).toBe(0);
  });

  it("covers every input annotation in order: no callout, no box and skipped", () => {
    const { report } = reportFor([
      annotation({ copy: "", index: 1 }),
      annotation({ selector: "#gone", copy: "Gone" }),
      { step: "toolbar", selector: "#nobox", copy: "No box" },
    ]);
    expect(report.map((r) => r.mode)).toEqual(["none", "outside", "none"]);
    expect(report[0]!.callout).toBeNull();
    expect(report[0]!.badge).not.toBeNull();
    expect(report[2]).toMatchObject({ skipped: "no bounding_box", unplaceable: false });
  });

  it("reports an inside placement with no side", () => {
    const panel = { x: 100, y: 100, width: 400, height: 300 };
    const { report } = reportFor([
      annotation({ bounding_box: panel, placement: { inside: true } }),
    ]);
    expect(report[0]).toMatchObject({ mode: "inside", side: null });
  });

  it("does not change the drawn tree", () => {
    const anns = () => [annotation({ obstacles: COLUMNS, index: 1 })];
    const plain = buildBurnTree({ image: IMAGE, annotations: anns(), metrics: METRICS });
    expect(reportFor(anns()).tree).toEqual(plain);
  });

  it("is deterministic, report and PNG bytes alike", async () => {
    const anns = () => [annotation({ obstacles: WALL, index: 1 }), annotation({ index: 2 })];
    const shot = solidPng(800, 600);
    const a = await renderBurn({ screenshotBuffer: shot, annotations: anns() });
    const b = await renderBurn({ screenshotBuffer: shot, annotations: anns() });
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    expect(a.png.equals(b.png)).toBe(true);
    expect(
      (await burnAnnotations({ screenshotBuffer: shot, annotations: anns() })).equals(a.png),
    ).toBe(true);
  });
});

describe("burnReport", () => {
  it("wraps flow reports with the schema, threshold and unplaceable count", () => {
    const hopeless = reportFor([annotation({ obstacles: WALL })]).report;
    const fine = reportFor([annotation({})]).report;
    const doc = burnReport([
      { flow: "a", annotations: hopeless },
      { flow: "b", annotations: fine },
    ]);
    expect(doc).toMatchObject({
      schema: BURN_REPORT_SCHEMA,
      threshold: DEFAULT_UNPLACEABLE_RATIO,
      unplaceable: 1,
    });
    expect(doc.flows.map((f) => f.flow)).toEqual(["a", "b"]);
    expect(burnReport([], 0.3).threshold).toBe(0.3);
  });
});

describe("burn --report", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-burn-report-"));
    const flowDir = path.join(tmp, "docs", "recap");
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow: "recap",
        annotations: [
          annotation({ step: "open", obstacles: WALL }),
          annotation({ step: "ghost", selector: "#ghost" }),
        ],
      }),
    );
    await fs.writeFile(path.join(flowDir, "screenshots", "open.png"), solidPng(800, 600));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("burnFlow returns the flow's report, steps without a screenshot included", async () => {
    const r = await burnFlow({ docsDir: path.join(tmp, "docs"), flow: "recap", warn: () => {} });
    expect(r.report.flow).toBe("recap");
    expect(r.report.annotations.map((a) => [a.step, a.mode, a.skipped])).toEqual([
      ["open", "outside", undefined],
      ["ghost", "none", "no screenshot"],
    ]);
    expect(r.report.annotations[0]!.unplaceable).toBe(true);
  });

  it("writes the JSON report to the file named by --report", async () => {
    const file = path.join(tmp, "out", "report.json");
    const code = await runViewerCli(["burn", tmp, "--report", file]);
    expect(code).toBe(0);
    const doc = JSON.parse(await fs.readFile(file, "utf8"));
    expect(doc.schema).toBe(BURN_REPORT_SCHEMA);
    expect(doc.unplaceable).toBe(1);
    expect(doc.flows[0].flow).toBe("recap");
    expect(doc.flows[0].annotations[0]).toMatchObject({ step: "open", unplaceable: true });
    // the image is burned regardless
    await expect(
      fs.stat(path.join(tmp, "docs", "recap", "burned", "open.png")),
    ).resolves.toBeTruthy();
  });

  it("takes --max-overlap and rejects a bad one", async () => {
    const file = path.join(tmp, "report.json");
    expect(await runViewerCli(["burn", tmp, "--report", file, "--max-overlap", "9"])).toBe(0);
    const doc = JSON.parse(await fs.readFile(file, "utf8"));
    expect(doc.threshold).toBe(9);
    expect(doc.unplaceable).toBe(0);
    expect(await runViewerCli(["burn", tmp, "--max-overlap", "-1"])).toBe(2);
    expect(await runViewerCli(["burn", tmp, "--max-overlap", "abc"])).toBe(2);
  });

  it("writes no report file without --report", async () => {
    expect(await runViewerCli(["burn", tmp])).toBe(0);
    await expect(fs.stat(path.join(tmp, "report.json"))).rejects.toThrow();
  });
});
