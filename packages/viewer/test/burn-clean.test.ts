// The clean look of a line-connected burn: captions never land on text the capture sidecar lists,
// nor on each other or a badge; badges and halo rings stay off the target; text is estimated from
// pixels, and a listed box with nothing drawn in it is dropped.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeScreenshot } from "../src/screenshot-pixels.js";
import { renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME, type BurnTheme } from "../src/burn-theme.js";
import { recordsFromSidecar } from "../src/pack-annotations.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { overlapArea } from "../src/obstacle-placement.js";
import { busyCells, fullHeightDividers, textBoxes } from "../src/pixel-obstacles.js";
import {
  badgeInsets,
  chromeBoxes,
  cornerBadge,
  desktopSideBoxes,
  haloBox,
  shrinkSteps,
  withPixelObstacles,
} from "../src/burn-clean.js";
import type { PixelGrid } from "../src/connector-contrast.js";
import type { Rect } from "../src/placement.js";
import { encodePng } from "./helpers/png.js";

const THEME: BurnTheme = {
  ...DEFAULT_BURN_THEME,
  accent: "#a64dff",
  calloutBorderColor: "#a64dff",
  fontSize: 15,
  lineHeight: 21,
};

// A 1280 x 800 app screen as a capture sidecar lists it: a table of text cells (two columns, ten
// rows), a header button, empty space right of the table and under it.
const W = 1280;
const H = 800;
const cells: Rect[] = [];
for (let row = 0; row < 10; row++) {
  cells.push({ x: 100, y: 120 + row * 40, width: 200, height: 18 });
  cells.push({ x: 400, y: 120 + row * 40, width: 200, height: 18 });
}
const header = [
  { x: 24, y: 20, width: 90, height: 20 },
  { x: 1100, y: 16, width: 100, height: 30 },
];
const texts = [...cells, ...header];
const targets = [cells[7]!, header[1]!, cells[16]!];
const COPY = [
  "Blocked tasks stay red until an owner unblocks them",
  "Add a task to the ledger from anywhere",
  "Progress fills as subtasks close",
];
const sidecar = {
  width: W,
  height: H,
  annotations: targets.map((bbox, i) => ({
    index: i + 1,
    copy: COPY[i],
    bbox,
    obstacles: texts.filter((t) => t !== bbox),
  })),
};

const area = (a: Rect, b: Rect) => overlapArea(a, b);

describe("captions on a screen with listed text", () => {
  it("cover no text box, no other caption and no badge", async () => {
    const records = recordsFromSidecar("ledger", sidecar.annotations, "ledger.en.dark.1280.json");
    const { report } = await renderBurn({
      screenshotBuffer: stripedPng(W, H, texts),
      annotations: records,
      options: { theme: THEME },
    });
    const callouts = report.map((r) => r.callout!);
    const badges = report.map((r) => r.badge!);
    for (const [i, c] of callouts.entries()) {
      for (const t of texts) expect(area(c, t), `caption ${i + 1} on text`).toBe(0);
      for (const [j, other] of callouts.entries()) {
        if (j !== i) expect(area(c, other), `caption ${i + 1} on caption ${j + 1}`).toBe(0);
      }
      for (const b of badges) expect(area(c, b), `caption ${i + 1} on a badge`).toBe(0);
    }
  });

  it("keeps each badge off its target", async () => {
    const records = recordsFromSidecar("ledger", sidecar.annotations, "ledger.en.dark.1280.json");
    const { report } = await renderBurn({
      screenshotBuffer: stripedPng(W, H, texts),
      annotations: records,
      options: { theme: THEME },
    });
    report.forEach((r, i) => expect(area(r.badge!, targets[i]!), `badge ${i + 1}`).toBe(0));
  });
});

describe("the halo ring", () => {
  it("is drawn outside the target with the line connector, on it with the triangle", () => {
    const t = { x: 100, y: 100, width: 80, height: 30 };
    expect(haloBox(t, true, 1)).toEqual({ x: 95, y: 95, width: 90, height: 40 });
    expect(haloBox(t, true, 2)).toEqual({ x: 90, y: 90, width: 100, height: 50 });
    expect(haloBox(t, false, 2)).toBe(t);
  });
});

/** A light grey grid with striped blocks (text-like edges both ways) at `texts`. */
function striped(width: number, height: number, ...texts: Rect[]): PixelGrid {
  const rgba = new Uint8Array(width * height * 4).fill(240);
  for (const text of texts) {
    for (let y = text.y; y < text.y + text.height; y++) {
      for (let x = text.x; x < text.x + text.width; x++) {
        const ink = (x + y) % 3 === 0 ? 20 : 240;
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = ink;
      }
    }
  }
  return { width, height, rgba };
}

function stripedPng(width: number, height: number, texts: Rect[]): Buffer {
  const g = striped(width, height, ...texts);
  return encodePng(g.rgba, g.width, g.height);
}

describe("text estimated from pixels", () => {
  const text = { x: 200, y: 64, width: 160, height: 16 };
  const grid = striped(400, 300, text);
  const target = { x: 40, y: 120, width: 60, height: 30 };

  it("finds the striped block and nothing on the flat background", () => {
    const boxes = textBoxes(busyCells(grid), target);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(area(b, text)).toBeGreaterThan(0);
    const covered = boxes.reduce((s, b) => s + area(b, text), 0);
    expect(covered).toBe(text.width * text.height);
  });

  it("drops a listed box with nothing drawn in it and adds the text it finds", () => {
    const ann = { step: "s", selector: "#t", copy: "x", bounding_box: target };
    const found = withPixelObstacles(ann, target, grid, 1).obstacles!;
    expect(found.length).toBeGreaterThan(0);
    const shown = { x: 200, y: 64, width: 24, height: 16 };
    const listed = { ...ann, obstacles: [{ x: 0, y: 0, width: 20, height: 20 }, shown] };
    expect(withPixelObstacles(listed, target, grid, 1).obstacles).toEqual([shown, ...found]);
  });

  it("keeps a themed caption off the text in a pixel-only burn", async () => {
    // The text sits right above the target, where the caption would go by default.
    const block = { x: 120, y: 90, width: 220, height: 30 };
    const png = stripedPng(480, 320, [block]);
    const { report } = await renderBurn({
      screenshotBuffer: png,
      annotations: [
        {
          step: "s",
          selector: "#t",
          copy: "Opens the ledger",
          bounding_box: { x: 180, y: 160, width: 80, height: 28 },
        },
      ],
      options: { theme: THEME },
    });
    expect(area(report[0]!.callout!, block)).toBe(0);
  });
});

describe("caption_style", () => {
  const target = { x: 150, y: 400, width: 90, height: 30 };
  const one = [{ step: "s", selector: "#t", copy: "Opens the ledger", bounding_box: target }];
  const burn = (png: Buffer, captionStyle: BurnTheme["captionStyle"]) =>
    renderBurn({
      screenshotBuffer: png,
      annotations: structuredClone(one),
      options: { theme: { ...THEME, captionStyle }, warn: () => {} },
    });

  it("parses full, badge and auto, defaults to auto and refuses others", () => {
    const resolve = (block: unknown) =>
      resolveBurnTheme(parseThemeConfig(block), { workspace: "/tmp/docsxai-theme-workspace" });
    expect(resolve({}).captionStyle).toBe("auto");
    expect(resolve({ preset: "clean" }).captionStyle).toBe("auto");
    expect(resolve({ caption_style: "full" }).captionStyle).toBe("full");
    expect(resolve({ caption_style: "auto" }).captionStyle).toBe("auto");
    expect(() => resolve({ caption_style: "none" })).toThrow(/caption_style/);
  });

  it("badge draws the numbered badge and ring only, numbered by position", async () => {
    const { report } = await burn(stripedPng(390, 844, []), "badge");
    expect(report[0]!.callout).toBeNull();
    expect(report[0]!.caption_style).toBe("badge");
    expect(report[0]!.badge).not.toBeNull();
    expect(area(report[0]!.badge!, target)).toBe(0);
  });

  it("auto keeps the caption where a clear spot exists", async () => {
    const { report } = await burn(stripedPng(390, 844, []), "auto");
    expect(report[0]!.callout).not.toBeNull();
    expect(report[0]!.caption_style).toBeUndefined();
  });

  it("auto falls back to the badge when text fills every spot", async () => {
    const page = [
      { x: 0, y: 0, width: 390, height: target.y - 2 },
      { x: 0, y: target.y + target.height + 2, width: 390, height: 844 },
      { x: 0, y: target.y, width: 148, height: target.height },
      { x: 242, y: target.y, width: 148, height: target.height },
    ];
    const { report } = await burn(stripedPng(390, 844, page), "auto");
    expect(report[0]!.callout).toBeNull();
    expect(report[0]!.caption_style).toBe("badge");
  });
});

describe("caption_style default at 1280", () => {
  // A 1280 x 800 frame where listed text fills every side of the target, so no caption spot is clear.
  const target = { x: 560, y: 380, width: 140, height: 36 };
  const boxed = [
    { x: 0, y: 0, width: 1280, height: target.y - 4 },
    { x: 0, y: target.y + target.height + 4, width: 1280, height: 800 },
    { x: 0, y: target.y - 4, width: target.x - 4, height: target.height + 8 },
    { x: target.x + target.width + 4, y: target.y - 4, width: 1280, height: target.height + 8 },
  ];
  const run = (theme: BurnTheme) =>
    renderBurn({
      screenshotBuffer: stripedPng(1280, 800, boxed),
      annotations: [
        {
          step: "s",
          selector: "#t",
          copy: "Opens the ledger",
          bounding_box: target,
          obstacles: boxed,
        },
      ],
      options: { theme, warn: () => {} },
    });

  it("burns the badge only when every placement collides", async () => {
    const { report } = await run(THEME);
    expect(report[0]!.callout).toBeNull();
    expect(report[0]!.mode).toBe("none");
    expect(report[0]!.caption_style).toBe("badge");
    expect(report[0]!.badge).not.toBeNull();
  });

  it("still draws the caption with an explicit full", async () => {
    const { report } = await run({ ...THEME, captionStyle: "full" });
    expect(report[0]!.callout).not.toBeNull();
    expect(report[0]!.caption_style).toBeUndefined();
  });
});

describe("phone chrome", () => {
  it("blocks the header, the bottom nav and the floating button on a portrait phone capture", () => {
    const boxes = chromeBoxes({ width: 390, height: 844 }, 1, 390, false);
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 390, height: 56 },
      { x: 0, y: 788, width: 390, height: 56 },
      { x: 314, y: 708, width: 76, height: 80 },
    ]);
    expect(chromeBoxes({ width: 390, height: 844 }, 1, 390, true)).toHaveLength(5);
  });

  it("scales the bands, the button and the side margins with the pixel ratio of a 2x capture", () => {
    expect(chromeBoxes({ width: 780, height: 1688 }, 1, 390, true, 2)).toEqual([
      { x: 0, y: 0, width: 780, height: 112 },
      { x: 0, y: 1576, width: 780, height: 112 },
      { x: 628, y: 1416, width: 152, height: 160 },
      { x: 0, y: 0, width: 32, height: 1688 },
      { x: 748, y: 0, width: 32, height: 1688 },
    ]);
  });

  it("still counts a 2x phone capture as a phone by its CSS width", () => {
    expect(chromeBoxes({ width: 780, height: 1688 }, 1, 390, false, 2)).toHaveLength(3);
    expect(chromeBoxes({ width: 2560, height: 1600 }, 1, 1280, false, 2)).toEqual([]);
  });

  it("doubles the smallest text a 2x caption shrinks to", () => {
    expect(shrinkSteps(15, 2.23, 390)[1]).toBeCloseTo(14 / (15 * 2.23));
    expect(shrinkSteps(15, 4.46, 390, 2)[1]).toBeCloseTo(28 / (15 * 4.46));
  });

  it("is absent on a desktop or a landscape capture", () => {
    expect(chromeBoxes({ width: 1280, height: 800 }, 1, 1280, true)).toEqual([]);
    expect(chromeBoxes({ width: 400, height: 300 }, 1, 400, true)).toEqual([]);
  });
});

describe("text found in a real capture", () => {
  it("finds a small grey form label (the 'Issue a token' label of a phone capture)", async () => {
    // 200 x 40 px cut from a 390 px dark capture; the label sits at x 16, y 12, 74 x 13.
    const png = await fs.readFile(
      new URL("./fixtures/trackxai/issue-label-crop.png", import.meta.url),
    );
    const boxes = textBoxes(busyCells(decodeScreenshot(png, 200, 40)), {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    const label = { x: 16, y: 12, width: 74, height: 13 };
    const covered = boxes.reduce((n, b) => n + area(b, label), 0);
    expect(covered / (label.width * label.height)).toBeGreaterThan(0.6);
  });
});

describe("a 2x phone capture", () => {
  const auto: BurnTheme = {
    ...THEME,
    scale: "auto",
    displayWidth: 1100,
    displayWidthNarrow: 350,
    narrowBelow: 900,
    captionStyle: "auto",
  };
  // 780 x 1688 device px for a 390 x 844 CSS viewport; target 180 x 60 px in the middle.
  const target = { x: 300, y: 800, width: 180, height: 60 };
  const run = (pixelRatio: number | undefined) =>
    renderBurn({
      screenshotBuffer: stripedPng(780, 1688, []),
      annotations: [
        { step: "s", selector: "#t", index: 1, copy: "Opens the ledger", bounding_box: target },
      ],
      options: { theme: auto, warn: () => {}, ...(pixelRatio ? { pixelRatio } : {}) },
    });

  it("keeps the caption off the header, the nav and the button bands at pixelRatio 2", async () => {
    const { report } = await run(2);
    const bands = chromeBoxes({ width: 780, height: 1688 }, 1, 390, false, 2);
    for (const b of bands) {
      expect(area(report[0]!.callout!, b)).toBe(0);
      expect(area(report[0]!.badge!, b)).toBe(0);
    }
  });

  it("draws a caption about 2.23 times the base size, as at 1x with the same display width", async () => {
    const { report } = await run(2);
    const one = await renderBurn({
      screenshotBuffer: stripedPng(390, 844, []),
      annotations: [
        {
          step: "s",
          selector: "#t",
          index: 1,
          copy: "Opens the ledger",
          bounding_box: { x: 150, y: 400, width: 90, height: 30 },
        },
      ],
      options: { theme: auto, warn: () => {} },
    });
    const ratio = report[0]!.callout!.height / one.report[0]!.callout!.height;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });
});

describe("text estimated from a 2x capture", () => {
  it("finds the same boxes as the 1x capture, in twice the pixels", () => {
    const text = { x: 200, y: 64, width: 160, height: 16 };
    const small = striped(400, 300, text);
    // Every pixel drawn as a 2 x 2 block: the same page at a pixel ratio of 2.
    const rgba = new Uint8Array(800 * 600 * 4);
    for (let y = 0; y < 600; y++) {
      for (let x = 0; x < 800; x++) {
        const from = ((y >> 1) * 400 + (x >> 1)) * 4;
        rgba.set(small.rgba.subarray(from, from + 4), (y * 800 + x) * 4);
      }
    }
    const none = { x: 0, y: 0, width: 0, height: 0 };
    const one = textBoxes(busyCells(small), none);
    const two = textBoxes(busyCells({ width: 800, height: 600, rgba }, 2), none);
    expect(one.length).toBeGreaterThan(0);
    expect(two).toEqual(
      one.map((b) => ({ x: b.x * 2, y: b.y * 2, width: b.width * 2, height: b.height * 2 })),
    );
  });
});

describe("badge margins", () => {
  const size = { width: 30, height: 30 };
  const image = { width: 400, height: 800 };

  it("keeps a badge 6 CSS px off every edge of a phone capture, 12 off the sides of a desktop one", () => {
    expect(badgeInsets(1, 390)).toEqual({ side: 6, edge: 6 });
    expect(badgeInsets(1, 1280)).toEqual({ side: 12, edge: 6 });
    expect(badgeInsets(2, 390, 2)).toEqual({ side: 6, edge: 6 });
    expect(badgeInsets(1, 390, 2)).toEqual({ side: 12, edge: 12 });
  });

  it("slides a corner badge back in along the edge, still next to its target", () => {
    const target = { x: 8, y: 300, width: 200, height: 60 };
    const badge = cornerBadge(target, size, image, [], {
      badgeObstacles: [],
      insets: { side: 6, edge: 6 },
    });
    expect(badge.x).toBe(6);
    expect(badge.y).toBe(target.y - size.height - 1);
    const low = cornerBadge({ x: 150, y: 770, width: 100, height: 20 }, size, image, [], {
      badgeObstacles: [],
      insets: { side: 6, edge: 6 },
    });
    expect(low.y + low.height).toBeLessThanOrEqual(800 - 6);
  });

  it("keeps the desktop side strips and nothing on a phone", () => {
    expect(desktopSideBoxes({ width: 1100, height: 700 }, 1280 / 1100, 1280)).toEqual([
      { x: 0, y: 0, width: 12 / (1280 / 1100), height: 700 },
      { x: 1100 - 12 / (1280 / 1100), y: 0, width: 12 / (1280 / 1100), height: 700 },
    ]);
    expect(desktopSideBoxes({ width: 390, height: 844 }, 1, 390)).toEqual([]);
  });
});

describe("full-height dividers", () => {
  const grid = (
    width: number,
    height: number,
    paint: (x: number, y: number) => number,
  ): PixelGrid => {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = paint(x, y);
        rgba[i + 3] = 255;
      }
    }
    return { width, height, rgba };
  };

  it("finds a sidebar's 1 px border as one box the height of the page", () => {
    const g = grid(300, 200, (x) => (x < 100 ? 14 : x === 100 ? 60 : 22));
    expect(fullHeightDividers(g)).toEqual([{ x: 100, y: 0, width: 2, height: 200 }]);
  });

  it("finds a plain step between a sidebar and the page", () => {
    const g = grid(300, 200, (x) => (x < 100 ? 14 : 40));
    expect(fullHeightDividers(g)).toEqual([{ x: 100, y: 0, width: 1, height: 200 }]);
  });

  it("ignores a card border that does not run the page", () => {
    const g = grid(300, 200, (x, y) => (x === 100 && y > 60 && y < 140 ? 80 : 14));
    expect(fullHeightDividers(g)).toEqual([]);
  });
});
