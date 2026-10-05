// Burned arrows and stems on dark screenshots: the ink connector gets a white outline there, and
// light screenshots burn to exactly what they did before.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBurnTree, burnAnnotations, burnFlow, type BurnNode } from "../src/burn.js";
import { runViewerCli } from "../src/index.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { lumaOf } from "../src/connector-contrast.js";
import { decodeScreenshot } from "../src/screenshot-pixels.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, layeredPng, pixelAt } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const W = 800;
const H = 600;
const IMAGE = { width: W, height: H, dataUri: "data:image/png;base64,AAAA" };
const DARK_BG = 20;
/** Smallest luma gap a connector must open against the dark background. */
const MIN_CONTRAST = 120;

// A 30x20 button between two text columns spanning y 200..400: free space only above and below,
// so the callout lands away from the target, joined to it by a stem.
const BUTTON = { x: 400, y: 300, width: 30, height: 20 };
const COLUMNS = [
  { x: 60, y: 200, width: 330, height: 200 },
  { x: 440, y: 200, width: 300, height: 200 },
];
const annotation = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "toolbar",
  selector: "#play",
  bounding_box: BUTTON,
  copy: "Click Play to open the recap sidebar",
  obstacles: COLUMNS,
  ...overrides,
});

const darkShot = () => layeredPng(W, H, DARK_BG, [{ ...BUTTON, grey: 60 }]);
const lightShot = () => layeredPng(W, H, 246, [{ ...BUTTON, grey: 255 }]);
// Left of x = 400 dark, right light: the connector above the button straddles both.
const mixedShot = (darkUntil: number) =>
  layeredPng(W, H, 246, [{ x: 0, y: 0, width: darkUntil, height: H, grey: DARK_BG }]);

const nodes = (tree: BurnNode) => (tree.props.children as BurnNode[]).slice(1);
const style = (n: BurnNode) => n.props.style!;
const rectOf = (n: BurnNode): Rect => ({
  x: style(n).left as number,
  y: style(n).top as number,
  width: style(n).width as number,
  height: style(n).height as number,
});
const inks = (t: BurnNode) => nodes(t).filter((n) => style(n).backgroundColor === "#1c1c1c");
const halos = (t: BurnNode) => nodes(t).filter((n) => style(n).backgroundColor === "#ffffff");

function treeWith(shot: Buffer | undefined, anns: AnnotationRecord[] = [annotation()]) {
  return buildBurnTree({
    image: IMAGE,
    annotations: anns,
    metrics: METRICS,
    ...(shot ? { pixels: decodeScreenshot(shot, W, H) } : {}),
  });
}

const lumaPx = (png: ReturnType<typeof decodePng>, x: number, y: number) => {
  const [r, g, b] = pixelAt(png, x, y);
  return lumaOf(r, g, b);
};

describe("burn on a light screenshot", () => {
  it("builds the very tree it builds without pixels", () => {
    const plain = treeWith(undefined);
    expect(halos(plain)).toHaveLength(0);
    expect(treeWith(lightShot())).toEqual(plain);
    expect(JSON.stringify(treeWith(lightShot()))).toBe(JSON.stringify(plain));
  });

  it("holds for a callout that sits right against its arrow too (no stem)", () => {
    const anns = [annotation({ obstacles: undefined, arrow_style: "bottom" })];
    expect(treeWith(lightShot(), anns)).toEqual(treeWith(undefined, anns));
  });

  it("burns to the same PNG bytes with the outline on auto and off", async () => {
    const auto = await burnAnnotations({
      screenshotBuffer: lightShot(),
      annotations: [annotation()],
    });
    const off = await burnAnnotations({
      screenshotBuffer: lightShot(),
      annotations: [annotation()],
      options: { connector: "off" },
    });
    expect(auto.equals(off)).toBe(true);
  });

  it("keeps a connector over a few dark text pixels plain", () => {
    // A thin dark line across the path: under a third of the pixels under the connector.
    const shot = layeredPng(W, H, 246, [{ x: 0, y: 250, width: W, height: 3, grey: 10 }]);
    expect(halos(treeWith(shot))).toHaveLength(0);
  });
});

describe("burn on a dark screenshot", () => {
  it("paints a white stem outline and arrow outline under the ink ones, ink unchanged", () => {
    const plain = treeWith(undefined);
    const tree = treeWith(darkShot());
    expect(halos(tree)).toHaveLength(2);
    expect(inks(tree).map(rectOf)).toEqual(inks(plain).map(rectOf));
    const all = nodes(tree);
    const lastHalo = Math.max(...halos(tree).map((n) => all.indexOf(n)));
    const firstInk = Math.min(...inks(tree).map((n) => all.indexOf(n)));
    expect(lastHalo).toBeLessThan(firstInk);
    // the callout box, the target halo and the badge are the nodes they were
    const stripped = all.filter((n) => !halos(tree).includes(n));
    expect(stripped).toEqual(nodes(plain));
  });

  it("outlines the stem 2 px each side, nudge included", () => {
    const anns = [annotation({ nudge: { x: 9, y: 0 } })];
    const tree = treeWith(darkShot(), anns);
    const stemInk = inks(tree).find((n) => !style(n).clipPath)!;
    const stemHalo = halos(tree).find((n) => !style(n).clipPath)!;
    const s = rectOf(stemInk);
    expect(rectOf(stemHalo)).toEqual({
      x: s.x - 2,
      y: s.y - 2,
      width: s.width + 4,
      height: s.height + 4,
    });
  });

  it("opens at least the minimum contrast against the background around the stem", async () => {
    const png = decodePng(
      await burnAnnotations({ screenshotBuffer: darkShot(), annotations: [annotation()] }),
    );
    const tree = treeWith(darkShot());
    const s = rectOf(inks(tree).find((n) => !style(n).clipPath)!);
    expect(s.height).toBeGreaterThan(s.width); // callout above or below: a vertical stem
    const midY = Math.floor(s.y + s.height / 2);
    for (const x of [s.x - 2, s.x - 1, s.x + s.width, s.x + s.width + 1]) {
      expect(lumaPx(png, x, midY) - DARK_BG).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    // the ink core stays near-black
    expect(lumaPx(png, s.x, midY)).toBeLessThan(40);
    // and the outline stops 2 px out
    expect(lumaPx(png, s.x - 3, midY)).toBe(DARK_BG);
  });

  it("outlines the arrow: a ring of near-white pixels around the ink tip", async () => {
    const burn = async (shot: Buffer, connector: "auto" | "off") =>
      decodePng(
        await burnAnnotations({
          screenshotBuffer: shot,
          annotations: [annotation()],
          options: { connector },
        }),
      );
    const tree = treeWith(darkShot());
    const a = rectOf(inks(tree).find((n) => style(n).clipPath)!);
    const region = { x0: a.x - 3, y0: a.y - 3, x1: a.x + a.width + 3, y1: a.y + a.height + 3 };
    const bright = (png: ReturnType<typeof decodePng>) => {
      let n = 0;
      for (let y = region.y0; y < region.y1; y++) {
        for (let x = region.x0; x < region.x1; x++) {
          if (lumaPx(png, x, y) - DARK_BG >= 200) n++;
        }
      }
      return n;
    };
    expect(bright(await burn(darkShot(), "off"))).toBe(0);
    expect(bright(await burn(darkShot(), "auto"))).toBeGreaterThan(40);
  });

  it("burns the same bytes twice, and changes no pixel outside the outline boxes", async () => {
    const run = (connector: "auto" | "off") =>
      burnAnnotations({
        screenshotBuffer: darkShot(),
        annotations: [annotation()],
        options: { connector },
      });
    const [a, b, off] = [await run("auto"), await run("auto"), await run("off")];
    expect(a.equals(b)).toBe(true);
    expect(a.equals(off)).toBe(false);
    const [pa, po] = [decodePng(a), decodePng(off)];
    // Blank the two outline boxes (plus a pixel of antialiasing) in both: the rest is identical.
    for (const r of halos(treeWith(darkShot())).map(rectOf)) {
      for (const img of [pa, po]) {
        for (let y = Math.floor(r.y) - 1; y < Math.ceil(r.y + r.height) + 1; y++) {
          img.rgba.fill(
            0,
            (y * W + Math.floor(r.x) - 1) * 4,
            (y * W + Math.ceil(r.x + r.width) + 1) * 4,
          );
        }
      }
    }
    expect(Buffer.from(pa.rgba).equals(Buffer.from(po.rgba))).toBe(true);
  });

  it("leaves the plain ink when the outline is switched off", async () => {
    const off = decodePng(
      await burnAnnotations({
        screenshotBuffer: darkShot(),
        annotations: [annotation()],
        options: { connector: "off" },
      }),
    );
    const s = rectOf(inks(treeWith(darkShot())).find((n) => !style(n).clipPath)!);
    expect(lumaPx(off, s.x - 1, Math.floor(s.y + s.height / 2))).toBe(DARK_BG);
  });

  it("outlines a connector only half over dark pixels", () => {
    // The connector sits at x ~ 400..430: dark up to 415 puts about half of it on dark.
    expect(halos(treeWith(mixedShot(415)))).toHaveLength(2);
    expect(halos(treeWith(mixedShot(395)))).toHaveLength(0);
  });

  it("decides per annotation: one on dark pixels, one on light", () => {
    const left = annotation({
      bounding_box: { x: 100, y: 300, width: 30, height: 20 },
      obstacles: [],
    });
    const right = annotation({
      bounding_box: { x: 600, y: 300, width: 30, height: 20 },
      obstacles: [],
    });
    const shot = mixedShot(300);
    const one = (a: AnnotationRecord) => halos(treeWith(shot, [a])).length;
    expect(one(left)).toBe(1);
    expect(one(right)).toBe(0);
    expect(halos(treeWith(shot, [left, right]))).toHaveLength(1);
  });
});

describe("burn --no-connector-outline", () => {
  it("keeps plain ink on a dark flow through burnFlow and the CLI, and outlines by default", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-burn-dark-"));
    try {
      const flowDir = path.join(tmp, "docs", "recap");
      await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
      await fs.writeFile(
        path.join(flowDir, "annotations.json"),
        JSON.stringify({
          schema: "docsxai/annotations@1",
          flow: "recap",
          annotations: [annotation({ step: "open" })],
        }),
      );
      await fs.writeFile(path.join(flowDir, "screenshots", "open.png"), darkShot());
      const read = (dir: string) => fs.readFile(path.join(dir, "recap", "open.png"));
      const [auto, plain, cli] = ["auto", "plain", "cli"].map((n) => path.join(tmp, n));
      await burnFlow({
        docsDir: path.join(tmp, "docs"),
        flow: "recap",
        outDir: path.join(auto!, "recap"),
      });
      await burnFlow({
        docsDir: path.join(tmp, "docs"),
        flow: "recap",
        outDir: path.join(plain!, "recap"),
        connector: "off",
      });
      expect(await runViewerCli(["burn", tmp, "--out", cli!, "--no-connector-outline"])).toBe(0);
      expect((await read(auto!)).equals(await read(plain!))).toBe(false);
      expect((await read(cli!)).equals(await read(plain!))).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
