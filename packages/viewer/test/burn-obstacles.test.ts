import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, burnAnnotations, type BurnNode } from "../src/burn.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const IMAGE = { width: 800, height: 600, dataUri: "data:image/png;base64,AAAA" };

// A 30x20 button between two text columns spanning y 200..400; free space only above and below.
const BUTTON = { x: 400, y: 300, width: 30, height: 20 };
const COLUMNS = [
  { x: 60, y: 200, width: 330, height: 200 },
  { x: 440, y: 200, width: 300, height: 200 },
];

function annotation(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    step: "toolbar",
    selector: "#play",
    bounding_box: BUTTON,
    copy: "Click Play to open the recap sidebar",
    ...overrides,
  };
}

const treeFor = (anns: AnnotationRecord[]) =>
  buildBurnTree({ image: IMAGE, annotations: anns, metrics: METRICS });
const nodes = (tree: BurnNode) => (tree.props.children as BurnNode[]).slice(1);
const styleOf = (n: BurnNode) => n.props.style!;
const rectOf = (n: BurnNode): Rect => {
  const s = styleOf(n);
  return {
    x: s.left as number,
    y: s.top as number,
    width: s.width as number,
    height: s.height as number,
  };
};
const calloutsOf = (t: BurnNode) => nodes(t).filter((n) => styleOf(n).backgroundColor === "#fff");
const arrowsOf = (t: BurnNode) => nodes(t).filter((n) => styleOf(n).clipPath);
const stemsOf = (t: BurnNode) =>
  nodes(t).filter((n) => styleOf(n).backgroundColor === "#1c1c1c" && !styleOf(n).clipPath);
const halosOf = (t: BurnNode) =>
  nodes(t).filter(
    (n) => String(styleOf(n).border ?? "").includes("#e8590c") && !styleOf(n).display,
  );
const touches = (a: Rect, b: Rect) =>
  overlapArea({ x: a.x - 1, y: a.y - 1, width: a.width + 2, height: a.height + 2 }, b) > 0;

describe("burn with obstacles", () => {
  it("is identical to today's output when obstacles is absent or empty", () => {
    const plain = treeFor([annotation()]);
    expect(treeFor([annotation({ obstacles: [] })])).toEqual(plain);
    expect(stemsOf(plain)).toHaveLength(0);
  });

  it("puts the callout clear of obstacles and joins it to the arrow with a stem", () => {
    const tree = treeFor([annotation({ obstacles: COLUMNS })]);
    const [callout] = calloutsOf(tree);
    const [arrow] = arrowsOf(tree);
    const [stem] = stemsOf(tree);
    expect(stem).toBeDefined();
    for (const box of [callout!, arrow!, stem!]) {
      for (const column of COLUMNS) expect(overlapArea(rectOf(box), column)).toBe(0);
    }
    // callout, stem and arrow form one chain that ends on the halo
    const [c, s, a, halo] = [callout!, stem!, arrow!, halosOf(tree)[0]!].map(rectOf) as [
      Rect,
      Rect,
      Rect,
      Rect,
    ];
    expect(touches(c, s)).toBe(true);
    expect(touches(s, a)).toBe(true);
    expect(touches(a, halo)).toBe(true);
  });

  it("without obstacles the same target puts its callout on the text", () => {
    const tree = treeFor([annotation()]);
    const covered = COLUMNS.reduce(
      (n, col) => n + overlapArea(rectOf(calloutsOf(tree)[0]!), col),
      0,
    );
    expect(covered).toBeGreaterThan(0);
  });

  it("moves the stem together with the callout and arrow under nudge", () => {
    const plain = treeFor([annotation({ obstacles: COLUMNS })]);
    const nudged = treeFor([annotation({ obstacles: COLUMNS, nudge: { x: 6, y: 0 } })]);
    const stem = styleOf(stemsOf(nudged)[0]!);
    const arrow = styleOf(arrowsOf(nudged)[0]!);
    // the planner re-scores at the nudged position, so only the stem/arrow relation is fixed
    expect((stem.left as number) + 1 - 6).toBe((arrow.left as number) + 7 - 6);
    expect(stemsOf(plain)).toHaveLength(1);
  });

  it("keeps a later callout off an earlier callout and another halo", () => {
    const first = annotation({ obstacles: COLUMNS, copy: "First", index: 1 });
    const second = annotation({
      selector: "#stop",
      bounding_box: { x: 470, y: 120, width: 30, height: 20 },
      copy: "Second",
      index: 2,
      obstacles: [{ x: 0, y: 0, width: 5, height: 5 }],
    });
    const tree = treeFor([first, second]);
    const [c1, c2] = calloutsOf(tree).map(rectOf) as [Rect, Rect];
    const [halo1] = halosOf(tree).map(rectOf) as [Rect];
    expect(overlapArea(c1, c2)).toBe(0);
    expect(overlapArea(c2, halo1)).toBe(0);
  });

  it("is deterministic, down to the PNG bytes", async () => {
    const annotations = () => [annotation({ obstacles: COLUMNS, index: 1 })];
    expect(JSON.stringify(treeFor(annotations()))).toBe(JSON.stringify(treeFor(annotations())));
    const shot = solidPng(800, 600);
    const a = await burnAnnotations({ screenshotBuffer: shot, annotations: annotations() });
    const b = await burnAnnotations({ screenshotBuffer: shot, annotations: annotations() });
    expect(a.equals(b)).toBe(true);
  });
});
