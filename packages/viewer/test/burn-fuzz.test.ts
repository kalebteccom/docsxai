// Seeded fuzz of the burn pipeline: 200 random scenarios (image size, annotations, labels, theme,
// obstacles) from a fixed seed, plus a small table of boxes the rasteriser cannot draw. Every
// scenario must burn without throwing, keep the image size, report each annotation once, place
// each callout inside the image and burn to the same bytes twice. No browser, no new dependency.

import { describe, expect, it } from "vitest";
import { renderBurn, pngDimensions } from "../src/burn.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { DEFAULT_BURN_THEME, type BurnTheme } from "../src/burn-theme.js";
import type { AnnotationRecord, BoundingBox } from "../src/annotations.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { decodePng, layeredPng } from "./helpers/png.js";

const SEED = 0x5eed_d0c5;
const SCENARIOS = 200;
/** Every n-th scenario is burned twice to compare bytes and fully decoded. Keeps the file fast. */
const DEEP_EVERY = 10;
/** Report rects are rounded to 2 decimals. */
const EPS = 0.011;

/** mulberry32: a 32-bit seeded generator. Same seed, same sequence, on every platform. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(private readonly next: () => number) {}
  float(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.float(lo, hi + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
}

const LABELS = [
  "",
  "Save",
  "Click Play to open the recap sidebar",
  "Pulsa Reproducir para abrir la barra lateral del resumen y revisar los últimos cambios",
  "Configuración avanzada: ñandú, canción, güero, ¿qué?",
  "هذا نص عربي طويل لاختبار الاتجاه من اليمين إلى اليسار في التعليق",
  "שלום עולם, זהו טקסט בעברית עבור הבדיקה",
  "Save 💾 then ship 🚀🚀🚀 to 👨‍👩‍👧‍👦",
  "word ".repeat(60).trim(),
  "A".repeat(180),
  "https://example.com/a/very/long/path/without/any/spaces/that/keeps/going/and/going/forever",
  "first line\nsecond line\n\nfourth line",
  "\t tabs\tand   many   spaces  ",
  "中文标签测试，日本語のラベルテスト",
];

const PRESETS = ["clean", "soft", "high-contrast", "readable"] as const;

function themeFor(rng: Rng): BurnTheme | undefined {
  if (rng.chance(0.3)) return undefined;
  const block: Record<string, unknown> = {};
  if (rng.chance(0.7)) block.preset = rng.pick(PRESETS);
  if (rng.chance(0.5))
    block.scale = rng.chance(0.4) ? "auto" : Math.round(rng.float(0.5, 4) * 100) / 100;
  if (rng.chance(0.5)) {
    block.display_width = rng.chance(0.5)
      ? rng.int(240, 2400)
      : {
          default: rng.int(240, 2400),
          narrow: rng.int(240, 600),
          narrow_below: rng.int(200, 1600),
        };
  }
  if (rng.chance(0.3)) block.font_size = rng.int(8, 32);
  if (rng.chance(0.3)) block.max_width_ratio = Math.round(rng.float(0.2, 1) * 100) / 100;
  if (rng.chance(0.2)) block.arrow_size = rng.int(4, 24);
  if (typeof block.font_size === "number")
    block.line_height = Math.min(64, block.font_size + rng.int(0, 12));
  return resolveBurnTheme(parseThemeConfig(block), { workspace: "/tmp/docsxai-fuzz-workspace" });
}

type Size = { width: number; height: number };

function boxFor(rng: Rng, image: Size, previous: BoundingBox[]): BoundingBox {
  const kind = rng.pick([
    "normal",
    "normal",
    "normal",
    "overhang",
    "tiny",
    "huge",
    "overlap",
    "outside",
  ]);
  const w = (max: number) => Math.max(1, Math.round(rng.float(4, max)));
  switch (kind) {
    case "tiny":
      return {
        x: rng.int(0, image.width),
        y: rng.int(0, image.height),
        width: rng.int(1, 3),
        height: rng.int(1, 3),
      };
    case "huge":
      return {
        x: rng.int(-50, 50),
        y: rng.int(-50, 50),
        width: image.width * rng.float(0.8, 3),
        height: image.height * rng.float(0.8, 3),
      };
    case "overhang": {
      const width = w(image.width * 0.6);
      const height = w(image.height * 0.4);
      return {
        x: rng.chance(0.5) ? image.width - width / 2 : -width / 2,
        y: rng.chance(0.5) ? image.height - height / 2 : -height / 2,
        width,
        height,
      };
    }
    case "overlap": {
      const p = previous.length > 0 ? rng.pick(previous) : { x: 10, y: 10, width: 40, height: 20 };
      return {
        x: p.x + rng.float(-10, 10),
        y: p.y + rng.float(-10, 10),
        width: p.width * rng.float(0.5, 1.5),
        height: p.height * rng.float(0.5, 1.5),
      };
    }
    case "outside":
      return {
        x: image.width + rng.int(1, 200),
        y: -rng.int(100, 400),
        width: w(80),
        height: w(40),
      };
    default:
      return {
        x: rng.int(0, image.width - 4),
        y: rng.int(0, image.height - 4),
        width: w(image.width * 0.5),
        height: w(image.height * 0.3),
      };
  }
}

function obstaclesFor(rng: Rng, image: Size, target: BoundingBox): BoundingBox[] | undefined {
  if (rng.chance(0.4)) return undefined;
  const list: BoundingBox[] = [];
  for (let i = rng.int(0, 8); i > 0; i--) {
    list.push(
      rng.chance(0.1)
        ? {
            x: 0,
            y: 0,
            width: image.width * rng.float(0.5, 1),
            height: image.height * rng.float(0.5, 1),
          }
        : rng.chance(0.15)
          ? { ...target, x: target.x + rng.float(-5, 5) }
          : {
              x: rng.int(-20, image.width),
              y: rng.int(-20, image.height),
              width: rng.int(4, image.width * 0.7),
              height: rng.int(4, 90),
            },
    );
  }
  return list;
}

interface Scenario {
  seed: number;
  image: Size;
  annotations: AnnotationRecord[];
  theme: BurnTheme | undefined;
  /** The input screenshot; built on demand so a scenario that is only inspected costs nothing. */
  png: () => Buffer;
}

function scenarioOf(seed: number): Scenario {
  const rng = new Rng(mulberry32(seed));
  // Raised to the 4th power, so most images are small and a few reach 1600 px.
  const dim = () => Math.round(120 + rng.float(0, 1) ** 4 * 1480);
  const image = { width: dim(), height: dim() };
  // Cubed too: mostly a few annotations, now and then all 12.
  const count = 1 + Math.floor(rng.float(0, 1) ** 3 * 12);
  const boxes: BoundingBox[] = [];
  const annotations: AnnotationRecord[] = [];
  for (let i = 0; i < count; i++) {
    const box = boxFor(rng, image, boxes);
    boxes.push(box);
    const obstacles = obstaclesFor(rng, image, box);
    const placement: AnnotationRecord["placement"] = {};
    if (rng.chance(0.2)) placement.side = rng.pick(["top", "bottom", "left", "right"] as const);
    if (rng.chance(0.1)) placement.inside = true;
    if (rng.chance(0.1)) placement.align = rng.pick(["start", "center", "end"] as const);
    if (rng.chance(0.1)) placement.max_width = rng.int(120, 560);
    annotations.push({
      step: "fuzz",
      selector: `#a${i}`,
      bounding_box: box,
      copy: rng.pick(LABELS),
      ...(count > 1 ? { index: i + 1 } : {}),
      ...(rng.chance(0.25)
        ? { arrow_style: rng.pick(["top", "bottom-left", "right", "top-right"]) }
        : {}),
      ...(obstacles ? { obstacles } : {}),
      ...(Object.keys(placement).length > 0 ? { placement } : {}),
    });
  }
  const theme = themeFor(rng);
  const rects = Array.from({ length: rng.int(0, 5) }, () => ({
    x: rng.int(0, image.width),
    y: rng.int(0, image.height),
    width: rng.int(10, image.width),
    height: rng.int(10, 120),
    grey: rng.int(0, 255),
  }));
  const base = rng.pick([255, 240, 40]);
  const png = () => layeredPng(image.width, image.height, base, rects);
  return { seed, image, annotations, theme, png };
}

/** What `fitBox` must do with a box: the image area it covers, or null when nothing is drawable. */
function drawable(box: BoundingBox | undefined, image: Size): boolean {
  if (!box) return false;
  const nums = [box.x, box.y, box.width, box.height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  return (
    Math.min(image.width, box.x + box.width) > Math.max(0, box.x) &&
    Math.min(image.height, box.y + box.height) > Math.max(0, box.y)
  );
}

async function burn(s: Scenario, warnings: string[] = []) {
  return renderBurn({
    screenshotBuffer: s.png(),
    annotations: structuredClone(s.annotations),
    options: { warn: (m) => warnings.push(m), ...(s.theme ? { theme: s.theme } : {}) },
  });
}

function expectReportMatches(report: AnnotationReport[], s: Scenario): void {
  expect(report).toHaveLength(s.annotations.length);
  s.annotations.forEach((a, i) => {
    const entry = report[i]!;
    expect(entry.selector).toBe(a.selector);
    if (drawable(a.bounding_box, s.image)) {
      expect(entry.skipped, `${a.selector} was drawable`).toBeUndefined();
    } else {
      expect(entry.skipped, `${a.selector} was not drawable`).toEqual(expect.any(String));
      expect(entry.skipped!.length).toBeGreaterThan(0);
      expect(entry).toMatchObject({ mode: "none", callout: null, badge: null });
    }
  });
}

/**
 * On each axis a callout that fits the image lies inside it. One larger than the image (a label
 * wider than a 120 px screenshot: the width is fixed at 280 without obstacles, 168 at the least
 * with them) cannot, and starts flush at the origin instead.
 */
function expectInside(
  rect: { x: number; y: number; width: number; height: number },
  s: Scenario,
  what: string,
): void {
  const label = `${what} ${JSON.stringify(rect)} in ${s.image.width}x${s.image.height}`;
  const axes = [
    [rect.x, rect.width, s.image.width],
    [rect.y, rect.height, s.image.height],
  ] as const;
  for (const [start, size, limit] of axes) {
    expect(start, label).toBeGreaterThanOrEqual(-EPS);
    if (size <= limit) expect(start + size, label).toBeLessThanOrEqual(limit + EPS);
    else expect(start, label).toBeLessThanOrEqual(EPS);
  }
}

const seedOf = (i: number): number => (SEED + i * 7919) >>> 0;

describe(`burn fuzz, ${SCENARIOS} seeded scenarios`, () => {
  for (let i = 0; i < SCENARIOS; i++) {
    const seed = seedOf(i);
    it(`scenario ${i} (seed ${seed})`, async () => {
      const s = scenarioOf(seed);
      const first = await burn(s);
      expect(pngDimensions(first.png)).toEqual(s.image);
      expectReportMatches(first.report, s);
      for (const entry of first.report) {
        if (entry.callout) expectInside(entry.callout, s, `callout ${entry.selector}`);
      }
      // Documented: with obstacles a badge stays fully inside the image.
      for (const [k, entry] of first.report.entries()) {
        if (entry.badge && s.annotations[k]!.obstacles?.length) {
          expectInside(entry.badge, s, `badge ${entry.selector}`);
        }
      }
      if (i % DEEP_EVERY === 0) {
        const img = decodePng(first.png);
        expect([img.width, img.height]).toEqual([s.image.width, s.image.height]);
        const again = await burn(s);
        expect(again.png.equals(first.png), "same seed, same bytes").toBe(true);
        expect(again.report).toEqual(first.report);
      }
    });
  }
});

describe("burn fuzz, generator coverage", () => {
  it("draws sizes, labels, themes and box kinds from the whole range", () => {
    const all = Array.from({ length: SCENARIOS }, (_, i) => scenarioOf(seedOf(i)));
    const dims = all.flatMap((s) => [s.image.width, s.image.height]);
    expect(Math.min(...dims)).toBeLessThan(130);
    expect(Math.max(...dims)).toBeGreaterThan(1500);
    const anns = all.flatMap((s) => s.annotations.map((a) => ({ a, s })));
    expect(new Set(anns.map(({ a }) => a.copy))).toEqual(new Set(LABELS));
    expect(Math.max(...all.map((s) => s.annotations.length))).toBe(12);
    expect(all.filter((s) => s.theme?.scale === "auto").length).toBeGreaterThan(20);
    expect(all.filter((s) => s.theme?.displayWidthNarrow != null).length).toBeGreaterThan(20);
    expect(all.filter((s) => !s.theme).length).toBeGreaterThan(30);
    const skipped = anns.filter(({ a, s }) => !drawable(a.bounding_box, s.image));
    expect(skipped.length).toBeGreaterThan(30);
    expect(anns.filter(({ a }) => a.obstacles?.length).length).toBeGreaterThan(100);
    expect(anns.filter(({ a }) => a.bounding_box!.width <= 3).length).toBeGreaterThan(30);
  });
});

describe("burn fuzz, unthemed output", () => {
  // A themed burn balances the lines of a long caption where an unthemed one wraps greedily, and
  // fills a connector that crosses dark pixels where an unthemed one outlines it. The copy is one
  // short word and the screenshot is white here, so what must match is placement and the triangle.
  it("equals the default theme with the triangle, byte for byte, on a sample of scenarios", async () => {
    for (let i = 0; i < 4; i++) {
      const base = scenarioOf((SEED + i * 104729) >>> 0);
      const s = {
        ...base,
        theme: undefined,
        annotations: base.annotations.map((a) => ({ ...a, copy: "Save" })),
        png: () => layeredPng(base.image.width, base.image.height, 255),
      };
      const plain = await burn(s);
      const explicit = await burn({
        ...s,
        theme: { ...DEFAULT_BURN_THEME, connectorStyle: "arrow" },
      });
      expect(explicit.png.equals(plain.png), `scenario ${i}`).toBe(true);
    }
  });
});

describe("burn fuzz, boxes the rasteriser cannot draw", () => {
  const bad: Array<[string, unknown]> = [
    ["NaN x", { x: Number.NaN, y: 5, width: 20, height: 20 }],
    ["NaN height", { x: 5, y: 5, width: 20, height: Number.NaN }],
    ["Infinity width", { x: 5, y: 5, width: Infinity, height: 20 }],
    ["-Infinity x", { x: -Infinity, y: 5, width: 20, height: 20 }],
    ["negative width", { x: 30, y: 5, width: -20, height: 20 }],
    ["negative height", { x: 5, y: 30, width: 20, height: -20 }],
    ["zero area", { x: 5, y: 5, width: 0, height: 0 }],
    ["entirely right of the image", { x: 5000, y: 5, width: 20, height: 20 }],
    ["entirely above the image", { x: 5, y: -500, width: 20, height: 20 }],
    ["huge coordinates", { x: 1e300, y: 1e300, width: 1e300, height: 1e300 }],
    ["string coordinates", { x: "5", y: "5", width: "20", height: "20" }],
    ["null fields", { x: null, y: null, width: null, height: null }],
    ["missing", undefined],
  ];
  for (const [name, box] of bad) {
    it(`skips a box with ${name} and still burns its neighbour`, async () => {
      const s: Scenario = {
        seed: 0,
        image: { width: 200, height: 150 },
        png: () => layeredPng(200, 150, 255),
        theme: undefined,
        annotations: [
          {
            step: "fuzz",
            selector: "#bad",
            bounding_box: box as BoundingBox,
            copy: "Bad",
            index: 1,
          },
          {
            step: "fuzz",
            selector: "#ok",
            bounding_box: { x: 60, y: 60, width: 40, height: 20 },
            copy: "Fine",
            index: 2,
          },
        ],
      };
      const warnings: string[] = [];
      const out = await burn(s, warnings);
      expect(pngDimensions(out.png)).toEqual(s.image);
      expectReportMatches(out.report, s);
      expect(out.report[0]!.skipped).toMatch(/bounding_box/);
      expect(warnings.length).toBeGreaterThan(0);
      expect(decodePng(out.png).width).toBe(200);
    });
  }

  it("survives non-finite obstacles, nudges and placement widths", async () => {
    const NaN_BOX = { x: Number.NaN, y: 0, width: 10, height: 10 };
    const s: Scenario = {
      seed: 0,
      image: { width: 300, height: 200 },
      png: () => layeredPng(300, 200, 255),
      theme: undefined,
      annotations: [
        {
          step: "fuzz",
          selector: "#a",
          bounding_box: { x: 100, y: 80, width: 50, height: 30 },
          copy: "Obstacles",
          obstacles: [NaN_BOX, { x: 0, y: 0, width: Infinity, height: 5 }],
        },
        {
          step: "fuzz",
          selector: "#b",
          bounding_box: { x: 20, y: 20, width: 50, height: 30 },
          copy: "Nudge",
          nudge: { x: Number.NaN, y: Infinity },
        },
        {
          step: "fuzz",
          selector: "#c",
          bounding_box: { x: 200, y: 120, width: 50, height: 30 },
          copy: "Width",
          placement: { max_width: Number.NaN },
        },
      ],
    };
    const out = await burn(s);
    expect(pngDimensions(out.png)).toEqual(s.image);
    expectReportMatches(out.report, s);
  });
});
