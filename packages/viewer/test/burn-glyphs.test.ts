// A caption with characters the font has no glyph for (Japanese, Arabic, Hebrew, Thai, Devanagari
// with the bundled Inter) burns as empty boxes. The burner finds them before it draws: a warning
// names the annotation and the script, the report entry lists the scripts under `missing_glyphs`,
// and `burn --strict-glyphs` exits 1.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBurnTree } from "../src/burn.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { parseFontMetrics, type FontMetrics } from "../src/font-metrics.js";
import { missingGlyphs } from "../src/burn-glyphs.js";
import { runViewerCli } from "../src/index.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const INTER = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);

describe("missingGlyphs", () => {
  it("finds nothing in text Inter covers", () => {
    for (const text of [
      "Click Play",
      "Café, niño, Größe",
      "Привет",
      "Καλημέρα",
      "1. a/b-c_d.e:f",
    ]) {
      expect(missingGlyphs(text, INTER)).toEqual({ scripts: [], characters: [] });
    }
  });

  it.each([
    ["ログイン", "Katakana"],
    ["設定を開く", "Han"],
    ["مرحبا", "Arabic"],
    ["שלום", "Hebrew"],
    ["สวัสดี", "Thai"],
    ["नमस्ते", "Devanagari"],
    ["안녕", "Hangul"],
  ])("names the script of %s", (text, script) => {
    expect(missingGlyphs(text, INTER).scripts).toContain(script);
  });

  it("lists scripts and characters once each, in reading order, and skips spaces", () => {
    const found = missingGlyphs("Open ログ ログ 設定", INTER);
    expect(found.scripts).toEqual(["Katakana", "Han"]);
    expect(found.characters).toEqual(["ロ", "グ", "設", "定"]);
  });

  it("calls an emoji an emoji", () => {
    expect(missingGlyphs("Ship it 🚀", INTER).scripts).toEqual(["Emoji"]);
  });

  it("checks nothing when the metrics cannot tell", () => {
    const blind: FontMetrics = { unitsPerEm: 1000, advanceWidth: () => 500 };
    expect(missingGlyphs("ログ", blind)).toEqual({ scripts: [], characters: [] });
  });
});

describe("buildBurnTree and missing glyphs", () => {
  const record = (copy: string, step = "login"): AnnotationRecord => ({
    step,
    selector: "#login",
    bounding_box: { x: 100, y: 100, width: 120, height: 40 },
    copy,
    index: 1,
  });
  const burn = (annotations: AnnotationRecord[]) => {
    const warnings: string[] = [];
    const report: AnnotationReport[] = [];
    buildBurnTree({
      image: { width: 800, height: 600, dataUri: "data:image/png;base64," },
      annotations,
      metrics: INTER,
      report,
      warn: (m) => void warnings.push(m),
    });
    return { warnings, report };
  };

  it("warns naming the annotation and the script, and lists the scripts in the report", () => {
    const { warnings, report } = burn([record("ログインを押す")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"#login" on step "login"/);
    expect(warnings[0]).toMatch(/Katakana/);
    expect(warnings[0]).toMatch(/burn\.theme\.font/);
    expect(report[0]!.missing_glyphs).toEqual(["Katakana", "Hiragana", "Han"]);
  });

  it("adds no key and no warning when the font covers the caption", () => {
    const { warnings, report } = burn([record("Press Log in")]);
    expect(warnings).toEqual([]);
    expect("missing_glyphs" in report[0]!).toBe(false);
  });
});

describe("docsxai-viewer burn --strict-glyphs", () => {
  let tmp = "";
  const write = async (copy: string) => {
    const flowDir = path.join(tmp, "docs", "login");
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow: "login",
        annotations: [
          {
            step: "open",
            selector: "#login",
            bounding_box: { x: 40, y: 50, width: 60, height: 24 },
            copy,
          },
        ],
      }),
    );
    await fs.writeFile(path.join(flowDir, "screenshots", "open.png"), solidPng(320, 200));
  };
  let err = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-glyphs-"));
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => void (err += `${String(m)}\n`));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("burns and exits 0 with a warning without the flag", async () => {
    await write("ログインを押す");
    expect(await runViewerCli(["burn", tmp])).toBe(0);
    expect(err).toMatch(/Katakana/);
  });

  it("exits 1 with the flag and says how many captions", async () => {
    await write("ログインを押す");
    expect(await runViewerCli(["burn", tmp, "--strict-glyphs"])).toBe(1);
    expect(err).toMatch(/1 caption has characters the font can't draw/);
  });

  it("exits 0 with the flag when every caption is covered", async () => {
    await write("Open the login page");
    expect(await runViewerCli(["burn", tmp, "--strict-glyphs"])).toBe(0);
  });
});
