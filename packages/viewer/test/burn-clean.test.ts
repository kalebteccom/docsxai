// The clean look of a line-connected burn: captions never land on text the capture sidecar lists,
// nor on each other or a badge; badges and halo rings stay off the target; text is estimated from
// pixels, and a listed box with nothing drawn in it is dropped.

import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME, type BurnTheme } from "../src/burn-theme.js";
import { recordsFromSidecar } from "../src/pack-annotations.js";
import { overlapArea } from "../src/obstacle-placement.js";
import { busyCells, textBoxes } from "../src/pixel-obstacles.js";
import { haloBox, withPixelObstacles } from "../src/burn-clean.js";
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
