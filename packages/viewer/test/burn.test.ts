import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  arrowGeometry,
  buildBurnTree,
  burnAnnotations,
  pngDimensions,
  type BurnNode,
} from "../src/burn.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

const IMAGE = { width: 800, height: 600, dataUri: "data:image/png;base64,AAAA" };
const CENTERED_BOX = { x: 360, y: 280, width: 80, height: 40 };

function buildAnnotation(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    step: "open-sidebar",
    selector: "#play",
    bounding_box: CENTERED_BOX,
    copy: "Click Play to open the recap sidebar",
    ...overrides,
  };
}

function treeFor(anns: AnnotationRecord[], warn?: (m: string) => void) {
  return buildBurnTree({ image: IMAGE, annotations: anns, metrics: METRICS, warn });
}

function overlayNodes(tree: BurnNode): BurnNode[] {
  return (tree.props.children as BurnNode[]).slice(1); // children[0] is the screenshot <img>
}
const styleOf = (n: BurnNode) => n.props.style!;
const haloOf = (tree: BurnNode) =>
  overlayNodes(tree).find((n) => String(styleOf(n).border ?? "").includes("#e8590c"));
const calloutOf = (tree: BurnNode) =>
  overlayNodes(tree).find((n) => styleOf(n).backgroundColor === "#fff");
const arrowOf = (tree: BurnNode) => overlayNodes(tree).find((n) => styleOf(n).clipPath);
const badgeOf = (tree: BurnNode) =>
  overlayNodes(tree).find((n) => styleOf(n).backgroundColor === "#e8590c");
const calloutLines = (callout: BurnNode) =>
  (callout.props.children as BurnNode[]).map((l) => l.props.children as string);

describe("arrowGeometry", () => {
  it("top: 14×8 downward triangle, tip bottom-center on the target's top edge", () => {
    const g = arrowGeometry("top", { x: 100, y: 50 });
    expect(g).toEqual({
      left: 93,
      top: 42,
      width: 14,
      height: 8,
      clipPath: "polygon(0% 0%, 100% 0%, 50% 100%)",
    });
  });

  it("bottom: upward triangle below the target edge", () => {
    const g = arrowGeometry("bottom", { x: 100, y: 50 });
    expect(g).toMatchObject({ left: 93, top: 50, width: 14, height: 8 });
    expect(g.clipPath).toBe("polygon(50% 0%, 100% 100%, 0% 100%)");
  });

  it("left: 8×14 rightward triangle left of the target edge", () => {
    const g = arrowGeometry("left", { x: 100, y: 50 });
    expect(g).toMatchObject({ left: 92, top: 43, width: 8, height: 14 });
    expect(g.clipPath).toBe("polygon(0% 0%, 100% 50%, 0% 100%)");
  });

  it("right: leftward triangle right of the target edge", () => {
    const g = arrowGeometry("right", { x: 100, y: 50 });
    expect(g).toMatchObject({ left: 100, top: 43, width: 8, height: 14 });
    expect(g.clipPath).toBe("polygon(100% 0%, 100% 100%, 0% 50%)");
  });
});

describe("buildBurnTree", () => {
  it("roots a full-bleed screenshot <img> at the image dimensions", () => {
    const tree = treeFor([buildAnnotation()]);
    expect(styleOf(tree).width).toBe(800);
    expect(styleOf(tree).height).toBe(600);
    const img = (tree.props.children as BurnNode[])[0]!;
    expect(img.type).toBe("img");
    expect(img.props.src).toBe(IMAGE.dataUri);
    expect(img.props.width).toBe(800);
    expect(img.props.height).toBe(600);
  });

  it("draws the halo exactly on the bounding box (accent border, glow)", () => {
    const halo = haloOf(treeFor([buildAnnotation()]))!;
    expect(styleOf(halo)).toMatchObject({ left: 360, top: 280, width: 80, height: 40 });
    expect(styleOf(halo).border).toBe("2px solid #e8590c");
  });

  it("skips an annotation without bounding_box and warns", () => {
    const warnings: string[] = [];
    const tree = treeFor(
      [buildAnnotation({ bounding_box: undefined })],
      (m) => void warnings.push(m),
    );
    expect(overlayNodes(tree)).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("open-sidebar");
    expect(warnings[0]).toContain("bounding_box");
  });

  it("places the callout above the target for the default arrow style (gap 10)", () => {
    const tree = treeFor([buildAnnotation({ copy: "Click" })]);
    const callout = styleOf(calloutOf(tree)!);
    expect((callout.top as number) + (callout.height as number) + 10).toBe(CENTERED_BOX.y);
  });

  it.each([
    ["top", "top"],
    ["top-left", "top"],
    ["top-right", "top"],
    ["bottom", "bottom"],
    ["bottom-left", "bottom"],
    ["bottom-right", "bottom"],
    ["left", "left"],
    ["right", "right"],
  ])("honors arrow_style %s → callout on the %s side", (arrowStyle, side) => {
    const tree = treeFor([buildAnnotation({ copy: "Hi", arrow_style: arrowStyle })]);
    const c = styleOf(calloutOf(tree)!);
    const t = CENTERED_BOX;
    if (side === "top") expect((c.top as number) + (c.height as number)).toBeLessThanOrEqual(t.y);
    if (side === "bottom") expect(c.top as number).toBeGreaterThanOrEqual(t.y + t.height);
    if (side === "left") expect((c.left as number) + (c.width as number)).toBeLessThanOrEqual(t.x);
    if (side === "right") expect(c.left as number).toBeGreaterThanOrEqual(t.x + t.width);
  });

  it("wraps long copy into multiple lines, none wider than the 280px outer clamp", () => {
    const copy =
      "Click the Play button in the toolbar to open the recap sidebar and review every step";
    const tree = treeFor([buildAnnotation({ copy })]);
    const callout = calloutOf(tree)!;
    const lines = calloutLines(callout);
    expect(lines.length).toBeGreaterThan(1);
    expect(styleOf(callout).width as number).toBeLessThanOrEqual(280);
    expect(lines.join(" ")).toBe(copy);
  });

  it("prefixes the callout copy with the index and renders a numbered badge", () => {
    const tree = treeFor([buildAnnotation({ index: 2, copy: "Second thing" })]);
    expect(calloutLines(calloutOf(tree)!)[0]).toContain("2. Second thing");
    const badge = badgeOf(tree)!;
    expect(badge.props.children).toBe("2");
    // top-left of the halo, pulled 8px outside it
    expect(styleOf(badge).left).toBe(CENTERED_BOX.x - 8);
    expect(styleOf(badge).top).toBe(CENTERED_BOX.y - 8);
  });

  it("renders no badge without an index", () => {
    expect(badgeOf(treeFor([buildAnnotation()]))).toBeUndefined();
  });

  it("clamps the badge inside the image for a target at the origin", () => {
    const tree = treeFor([
      buildAnnotation({ index: 1, bounding_box: { x: 0, y: 0, width: 30, height: 20 } }),
    ]);
    const badge = styleOf(badgeOf(tree)!);
    expect(badge.left).toBe(0);
    expect(badge.top).toBe(0);
  });

  it("applies nudge to callout and arrow but never the halo", () => {
    const plain = treeFor([buildAnnotation({ copy: "Hi" })]);
    const nudged = treeFor([buildAnnotation({ copy: "Hi", nudge: { x: 25, y: -10 } })]);
    expect(styleOf(haloOf(nudged)!)).toEqual(styleOf(haloOf(plain)!));
    expect(styleOf(calloutOf(nudged)!).left).toBe((styleOf(calloutOf(plain)!).left as number) + 25);
    expect(styleOf(calloutOf(nudged)!).top).toBe((styleOf(calloutOf(plain)!).top as number) - 10);
    expect(styleOf(arrowOf(nudged)!).left).toBe((styleOf(arrowOf(plain)!).left as number) + 25);
    expect(styleOf(arrowOf(nudged)!).top).toBe((styleOf(arrowOf(plain)!).top as number) - 10);
  });
});

describe("pngDimensions", () => {
  it("reads width and height from IHDR", () => {
    expect(pngDimensions(solidPng(400, 300))).toEqual({ width: 400, height: 300 });
  });

  it("rejects non-PNG input", () => {
    expect(() => pngDimensions(Buffer.from("definitely-not-a-png-but-long-enough"))).toThrow(
      /not a PNG/,
    );
  });
});

describe("burnAnnotations", () => {
  const SCREENSHOT = solidPng(400, 300);
  const BOX = { x: 150, y: 120, width: 80, height: 40 };

  it("is byte-deterministic: two runs produce identical PNGs", async () => {
    const input = () => ({
      screenshotBuffer: SCREENSHOT,
      annotations: [buildAnnotation({ bounding_box: BOX })],
    });
    const first = await burnAnnotations(input());
    const second = await burnAnnotations(input());
    expect(first.equals(second)).toBe(true);
  });

  it("burns visible overlay pixels at the box border + callout side, far corner untouched", async () => {
    const out = await burnAnnotations({
      screenshotBuffer: SCREENSHOT,
      annotations: [buildAnnotation({ bounding_box: BOX, copy: "Click Play" })],
    });
    const img = decodePng(out);
    expect(img.width).toBe(400);
    expect(img.height).toBe(300);

    // box border: accent-ish pixel on the halo's top edge (border drawn inside the box edge)
    const [r, g, b] = pixelAt(img, BOX.x + 40, BOX.y + 1);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(150);
    expect(b).toBeLessThan(100);

    // callout region: the area above the target is no longer blank (border/arrow/text pixels)
    let inked = 0;
    for (let y = 0; y < BOX.y - 4; y++) {
      for (let x = 0; x < img.width; x++) {
        const [pr, pg, pb] = pixelAt(img, x, y);
        if (pr < 250 || pg < 250 || pb < 250) inked++;
      }
    }
    expect(inked).toBeGreaterThan(50);

    // far corner unchanged
    expect(pixelAt(img, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(img, 396, 296)).toEqual([255, 255, 255, 255]);
  });

  it("accepts screenshotPath and matches the buffer-input output byte-for-byte", async () => {
    const tmp = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "burn-"));
    const p = path.join(tmp, "shot.png");
    await fs.writeFile(p, SCREENSHOT);
    const annotations = [buildAnnotation({ bounding_box: BOX })];
    const fromPath = await burnAnnotations({ screenshotPath: p, annotations });
    const fromBuffer = await burnAnnotations({ screenshotBuffer: SCREENSHOT, annotations });
    expect(fromPath.equals(fromBuffer)).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("throws when neither screenshotPath nor screenshotBuffer is given", async () => {
    await expect(burnAnnotations({ annotations: [] })).rejects.toThrow(/screenshotPath/);
  });

  it("warns and still renders when an annotation has no bounding_box", async () => {
    const warnings: string[] = [];
    const out = await burnAnnotations({
      screenshotBuffer: SCREENSHOT,
      annotations: [buildAnnotation({ bounding_box: undefined })],
      options: { warn: (m) => void warnings.push(m) },
    });
    expect(warnings).toHaveLength(1);
    expect(pngDimensions(out)).toEqual({ width: 400, height: 300 });
  });
});

describe("browser-free constraint", () => {
  it("no viewer source module imports playwright", async () => {
    const srcDir = new URL("../src/", import.meta.url);
    for (const file of await fs.readdir(srcDir)) {
      const source = await fs.readFile(new URL(file, srcDir), "utf8");
      expect(source).not.toMatch(/(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*playwright/i);
    }
  });
});
