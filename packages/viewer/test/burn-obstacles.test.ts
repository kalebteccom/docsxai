import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, burnAnnotations, type BurnNode } from "../src/burn.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

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

// A page title flush with a back arrow on its left and a breadcrumb row above it.
const TITLE = { x: 100, y: 100, width: 120, height: 24 };
const NEIGHBOURS = [
  { x: 40, y: 96, width: 56, height: 32 },
  { x: 100, y: 70, width: 200, height: 24 },
];
const badgesOf = (t: BurnNode) =>
  nodes(t).filter((n) => styleOf(n).backgroundColor === "#e8590c" && styleOf(n).display);
const titleAnnotation = (overrides: Partial<AnnotationRecord> = {}) =>
  annotation({
    step: "board",
    selector: "h1",
    bounding_box: TITLE,
    copy: "Board title",
    index: 1,
    ...overrides,
  });

describe("burn badge placement", () => {
  it("keeps the badge up-left of the halo without obstacles, as before", () => {
    const [badge] = badgesOf(treeFor([titleAnnotation()]));
    expect(rectOf(badge!)).toMatchObject({ x: TITLE.x - 8, y: TITLE.y - 8 });
    const [kept] = badgesOf(treeFor([titleAnnotation({ obstacles: [] })]));
    expect(rectOf(kept!)).toMatchObject({ x: TITLE.x - 8, y: TITLE.y - 8 });
  });

  it("keeps the badge off neighbours of a flush-text target", () => {
    const tree = treeFor([titleAnnotation({ obstacles: NEIGHBOURS })]);
    const [badge] = badgesOf(tree);
    const box = rectOf(badge!);
    expect(box).not.toMatchObject({ x: TITLE.x - 8, y: TITLE.y - 8 });
    for (const o of NEIGHBOURS) expect(overlapArea(box, o)).toBe(0);
  });

  it("burns the moved badge into the PNG and leaves the up-left spot to the page", async () => {
    const annotations = [titleAnnotation({ obstacles: NEIGHBOURS })];
    const box = rectOf(badgesOf(treeFor(annotations))[0]!);
    for (const o of NEIGHBOURS) expect(overlapArea(box, o)).toBe(0);

    const out = decodePng(
      await burnAnnotations({ screenshotBuffer: solidPng(800, 600), annotations }),
    );
    // inside the circle, left of the digit: accent fill at the new box, untouched page at the old one
    const [r, g, b] = pixelAt(out, box.x + 5, box.y + box.height / 2);
    expect([r, g, b]).toEqual([0xe8, 0x59, 0x0c]);
    // the default up-left box (92..118) no longer carries a badge
    expect(pixelAt(out, TITLE.x - 6, TITLE.y - 6)).toEqual(pixelAt(out, 700, 500));
  });

  it("is deterministic, down to the PNG bytes", async () => {
    const annotations = () => [titleAnnotation({ obstacles: NEIGHBOURS })];
    expect(JSON.stringify(treeFor(annotations()))).toBe(JSON.stringify(treeFor(annotations())));
    const shot = solidPng(800, 600);
    const a = await burnAnnotations({ screenshotBuffer: shot, annotations: annotations() });
    const b = await burnAnnotations({ screenshotBuffer: shot, annotations: annotations() });
    expect(a.equals(b)).toBe(true);
  });

  it("keeps a badge off another annotation's halo and earlier callout", () => {
    const other = annotation({
      selector: "#tabs",
      bounding_box: { x: 60, y: 60, width: 36, height: 16 },
      copy: "Tabs",
      index: 2,
    });
    const tree = treeFor([other, titleAnnotation({ obstacles: NEIGHBOURS })]);
    const box = rectOf(badgesOf(tree)[1]!);
    const [otherHalo] = halosOf(tree).map(rectOf) as [Rect];
    expect(overlapArea(box, otherHalo)).toBe(0);
    for (const c of calloutsOf(tree)) expect(overlapArea(box, rectOf(c))).toBe(0);
  });
});
