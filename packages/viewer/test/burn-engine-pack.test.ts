// Burns a doc pack the engine produced (`docsxai run` with `annotations.obstacles` on, against the
// engine's obstacles fixture page): annotations.json and the screenshot are the real outputs,
// checked in as a fixture. The engine's keystone proves what the engine writes; this proves the
// burner does the right thing with exactly that file.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnnotationsFile } from "../src/annotations.js";
import { buildBurnTree, burnFlow, pngDimensions, type BurnNode } from "../src/burn.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";

const DOCS = new URL("./fixtures/engine-obstacles/", import.meta.url).pathname;
const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

const annotationsFile = JSON.parse(
  await fs.readFile(path.join(DOCS, "obstacles", "annotations.json"), "utf8"),
) as AnnotationsFile;
const screenshot = await fs.readFile(path.join(DOCS, "obstacles", "screenshots", "share.png"));
const { width, height } = pngDimensions(screenshot);

const treeFor = (annotations: AnnotationsFile["annotations"]) =>
  buildBurnTree({
    image: { width, height, dataUri: "data:image/png;base64,AAAA" },
    annotations,
    metrics: METRICS,
  });
const nodes = (tree: BurnNode) => (tree.props.children as BurnNode[]).slice(1);
const rectOf = (n: BurnNode): Rect => {
  const s = n.props.style!;
  return {
    x: s.left as number,
    y: s.top as number,
    width: s.width as number,
    height: s.height as number,
  };
};
const calloutOf = (tree: BurnNode): Rect =>
  rectOf(nodes(tree).find((n) => n.props.style!.backgroundColor === "#fff")!);
const coverage = (box: Rect, obstacles: Rect[]) =>
  obstacles.reduce((sum, o) => sum + overlapArea(box, o), 0);

describe("burning a doc pack the engine wrote with obstacles", () => {
  const [record] = annotationsFile.annotations;
  const obstacles = record!.obstacles!;

  it("the fixture carries the engine's obstacles for a button with text and a link beside it", () => {
    expect(annotationsFile.annotations).toHaveLength(1);
    expect(obstacles.length).toBeGreaterThanOrEqual(3);
    expect({ width, height }).toEqual({ width: 1000, height: 700 });
  });

  it("puts the callout clear of every obstacle", () => {
    expect(coverage(calloutOf(treeFor([record!])), obstacles)).toBe(0);
  });

  it("would have covered page content without them", () => {
    const { obstacles: _dropped, ...bare } = record!;
    expect(coverage(calloutOf(treeFor([bare])), obstacles)).toBeGreaterThan(0);
  });

  describe("burnFlow", () => {
    let out = "";
    beforeEach(async () => {
      out = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-burn-engine-"));
    });
    afterEach(async () => {
      await fs.rm(out, { recursive: true, force: true });
    });

    it("writes a same-size PNG, identical on every run", async () => {
      const burn = async (dir: string) => {
        await burnFlow({ docsDir: DOCS, flow: "obstacles", outDir: path.join(out, dir) });
        return fs.readFile(path.join(out, dir, "share.png"));
      };
      const a = await burn("a");
      const b = await burn("b");
      expect(pngDimensions(a)).toEqual({ width, height });
      expect(a.equals(b)).toBe(true);
      expect(a.equals(screenshot)).toBe(false);
    });
  });
});
