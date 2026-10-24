// Captions in a script Inter lacks burn with a fallback font. Noto Sans Arabic, Hebrew, Thai and
// Devanagari ship in assets/fonts (subsetted, SIL OFL 1.1); other scripts come from the workspace
// through `burn.theme.font_fallback`. Arabic and Hebrew captions are laid out right to left and
// their badge takes the target's right corner. A Latin burn, themed or not, keeps its bytes.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBurn, type BurnRender } from "../src/burn.js";
import { DEFAULT_BURN_THEME, THEME_PRESETS, type BurnTheme } from "../src/burn-theme.js";
import { loadBurnTheme } from "../src/burn-theme-load.js";
import { captionDirection } from "../src/burn-fonts.js";
import type { AnnotationRecord } from "../src/annotations.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { decodePng, solidPng } from "./helpers/png.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const FIXTURES = new URL("./fixtures/fonts/", import.meta.url);

const record = (copy: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "s",
  selector: "#target",
  bounding_box: { x: 300, y: 260, width: 200, height: 60 },
  copy,
  index: 1,
  ...extra,
});

async function burn(
  copy: string,
  theme?: BurnTheme,
  warnings: string[] = [],
  extra: Partial<AnnotationRecord> = {},
) {
  return renderBurn({
    screenshotBuffer: solidPng(900, 600),
    annotations: [record(copy, extra)],
    options: { warn: (m) => void warnings.push(m), ...(theme ? { theme } : {}) },
  });
}

/** Dark pixels (luma under 128) inside `box`, by column. */
function inkColumns(png: Buffer, box: { x: number; y: number; width: number; height: number }) {
  const { width, rgba } = decodePng(png);
  const cols: number[] = [];
  for (let x = Math.ceil(box.x); x < Math.floor(box.x + box.width); x++) {
    let n = 0;
    for (let y = Math.ceil(box.y); y < Math.floor(box.y + box.height); y++) {
      const i = (y * width + x) * 4;
      const luma = 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
      if (luma < 128) n++;
    }
    cols.push(n);
  }
  return cols;
}

/** The text area of a callout: its box less outline and padding. */
function textArea(entry: AnnotationReport, padX = 11, padY = 8) {
  const c = entry.callout!;
  return {
    x: c.x + padX + 1,
    y: c.y + padY + 1,
    width: c.width - 2 * (padX + 1),
    height: c.height - 2 * (padY + 1),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("captionDirection", () => {
  it.each([
    ["שלום עולם", "rtl"],
    ["مرحبا بالعالم", "rtl"],
    ["123 שלום", "rtl"],
    ["Save שמור", "ltr"],
    ["Click Play", "ltr"],
    ["สวัสดี", "ltr"],
    ["", "ltr"],
  ])("%s reads %s", (text, dir) => {
    expect(captionDirection(text)).toBe(dir);
  });
});

describe("a Latin burn keeps its bytes", () => {
  // Hashes of the locked satori 0.63.2 before the fallback fonts existed. On a mismatch,
  // reinstall from the lockfile first.
  it("unthemed", async () => {
    const { png } = await renderBurn({
      screenshotBuffer: solidPng(1200, 900),
      annotations: [
        {
          step: "s",
          selector: "#play",
          bounding_box: { x: 150, y: 360, width: 240, height: 120 },
          copy: "Click Play to open the recap sidebar",
          index: 1,
        },
      ],
    });
    expect(sha(png)).toBe("8071634bcd28cdfac0adc9767fc9a41e13db7b0582f1240dee2a32c99dcd0a06");
  });

  it("themed with a preset", async () => {
    const theme = { ...DEFAULT_BURN_THEME, ...THEME_PRESETS.clean };
    const { png } = await burn("Open the settings and pick a plan", theme);
    expect(sha(png)).toBe(LATIN_CLEAN_SHA);
  });
});

const LATIN_CLEAN_SHA = "bd5e593631bd6b5524df1c66efb3a4367a62b36f8ef07587e102d2469f884a92";

describe("bundled fallback scripts", () => {
  // Pinned with the locked satori 0.63.2 and the fonts in assets/fonts.
  it.each([
    [
      "Arabic",
      "افتح الإعدادات واختر خطة",
      "7c8d805274a908e5282f1dfa39b09a62ebd8761c93c29d30c26d3367cd62af77",
    ],
    [
      "Hebrew",
      "פתח את ההגדרות ובחר תוכנית",
      "15f1042ff934c4024e12e0dd11eb8e06b20684c7c112476dcb292743abb34690",
    ],
    [
      "Thai",
      "เปิดการตั้งค่าแล้วเลือกแผน",
      "0c14ff0bf8cce807ae6b3c41262573379bf5b2a3d6f6d8d37c5c05d091fc5d06",
    ],
    [
      "Devanagari",
      "सेटिंग्स खोलें और योजना चुनें",
      "366dad3dd308787ffc04f6abd80fcb492e91652720c4120dcec3236fe5b8dd5f",
    ],
  ])("%s burns with ink and no missing glyphs", async (_script, copy, pinned) => {
    const warnings: string[] = [];
    const first = await burn(copy, undefined, warnings);
    expect(warnings).toEqual([]);
    const entry = first.report[0]!;
    expect(entry.missing_glyphs).toBeUndefined();
    expect(sum(inkColumns(first.png, textArea(entry)))).toBeGreaterThan(150);
    const again = await burn(copy);
    expect(sha(again.png)).toBe(sha(first.png));
    expect(sha(first.png)).toBe(pinned);
  });

  it("still warns for a script nothing covers", async () => {
    const warnings: string[] = [];
    const { report } = await burn("設定を開く", undefined, warnings);
    expect(report[0]!.missing_glyphs).toEqual(["Han", "Hiragana"]);
    expect(warnings[0]).toMatch(/font_fallback/);
  });
});

describe("right to left", () => {
  it("draws a Hebrew caption's first character rightmost", async () => {
    // Shin is the one wide letter, vav a thin stroke: the widest run of inked columns is the shin.
    // No index, so no "1." joins the line.
    const { png, report } = await burn("שווווווו", undefined, [], { index: undefined });
    const cols = inkColumns(png, textArea(report[0]!));
    let best = { start: 0, length: 0 };
    for (let i = 0, start = 0; i <= cols.length; i++) {
      if (i < cols.length && cols[i]! > 0) continue;
      if (i - start > best.length) best = { start, length: i - start };
      start = i + 1;
    }
    expect(best.length).toBeGreaterThan(5);
    expect(best.start).toBeGreaterThan(cols.length / 2);
  });

  it("sets the short last line of an Arabic caption against the right edge", async () => {
    const copy = "افتح الإعدادات ثم اختر الخطة المناسبة لفريقك من القائمة ثم احفظ";
    const { png, report } = await burn(copy);
    const entry = report[0]!;
    const area = textArea(entry);
    expect(area.height).toBeGreaterThan(30);
    const lastLine = { ...area, y: area.y + area.height - 19, height: 19 };
    const cols = inkColumns(png, lastLine);
    const first = cols.findIndex((n) => n > 0);
    const last = cols.length - 1 - [...cols].reverse().findIndex((n) => n > 0);
    expect(cols.length - 1 - last).toBeLessThan(6);
    expect(first).toBeGreaterThan(20);
  });

  it("puts the badge of a right-to-left caption on the target's right", async () => {
    const t = record("").bounding_box!;
    const rtl = (await burn("פתח את ההגדרות")).report[0]!.badge!;
    const ltr = (await burn("Open the settings")).report[0]!.badge!;
    expect(rtl.x).toBeGreaterThan(t.x + t.width / 2);
    expect(ltr.x).toBeLessThan(t.x + t.width / 2);
  });
});

describe("burn.theme.font_fallback", () => {
  let ws = "";
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-fallback-"));
    await fs.mkdir(path.join(ws, "fonts"));
    for (const f of ["test-cjk-square.ttf", "test-cjk-triangle.ttf"]) {
      await fs.copyFile(new URL(f, FIXTURES), path.join(ws, "fonts", f));
    }
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });
  const themeWith = async (fallback: unknown): Promise<BurnTheme> => {
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({ burn: { theme: { font_fallback: fallback } } }),
    );
    return (await loadBurnTheme(ws))!.theme;
  };

  it("resolves the files under the workspace, in order", async () => {
    const theme = await themeWith(["fonts/test-cjk-square.ttf", "fonts/test-cjk-triangle.ttf"]);
    expect(theme.fontFallback).toEqual([
      path.join(ws, "fonts", "test-cjk-square.ttf"),
      path.join(ws, "fonts", "test-cjk-triangle.ttf"),
    ]);
  });

  it("covers the characters the files have, with ink", async () => {
    const warnings: string[] = [];
    const theme = await themeWith(["fonts/test-cjk-square.ttf"]);
    const { png, report } = await burn("設定 ロイン", theme, warnings);
    expect(warnings).toEqual([]);
    expect(report[0]!.missing_glyphs).toBeUndefined();
    expect(
      sum(inkColumns(png, textArea(report[0]!, theme.paddingX, theme.paddingY))),
    ).toBeGreaterThan(500);
  });

  it("takes the first file that has a character, and is byte-stable", async () => {
    const square: BurnRender = await burn(
      "設定",
      await themeWith(["fonts/test-cjk-square.ttf", "fonts/test-cjk-triangle.ttf"]),
    );
    const again = await burn(
      "設定",
      await themeWith(["fonts/test-cjk-square.ttf", "fonts/test-cjk-triangle.ttf"]),
    );
    const triangle = await burn(
      "設定",
      await themeWith(["fonts/test-cjk-triangle.ttf", "fonts/test-cjk-square.ttf"]),
    );
    expect(sha(again.png)).toBe(sha(square.png));
    expect(sha(triangle.png)).not.toBe(sha(square.png));
  });

  it("leaves a Latin caption's bytes alone", async () => {
    const theme = await themeWith(["fonts/test-cjk-square.ttf"]);
    const plain = { ...theme };
    delete plain.fontFallback;
    const a = await burn("Open the settings", theme);
    const b = await burn("Open the settings", plain);
    expect(sha(a.png)).toBe(sha(b.png));
  });

  it.each([
    ["fonts/test-cjk-square.ttf", /font_fallback: .*list of/],
    [["fonts/a.woff2"], /font_fallback\[0\]: .*\.ttf or \.otf/],
    [["../outside.ttf"], /font_fallback\[0\]: .*outside the workspace/],
    [Array(9).fill("fonts/test-cjk-square.ttf"), /font_fallback: .*at most 8/],
  ])("refuses %j", async (value, message) => {
    await expect(themeWith(value)).rejects.toThrow(message);
  });

  it("names a fallback file that does not exist", async () => {
    await expect(themeWith(["fonts/gone.ttf"])).rejects.toThrow(
      /burn\.theme font_fallback .*gone\.ttf does not exist/,
    );
  });
});
