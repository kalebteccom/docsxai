import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lintHtml } from "../src/a11y-lint.js";
import { renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME, THEME_PRESETS } from "../src/burn-theme.js";
import { BurnThemeError } from "../src/burn-theme-config.js";
import { themeStyle, themeVariables } from "../src/burn-theme-css.js";
import { loadBurnTheme, loadThemeFont } from "../src/burn-theme-load.js";
import { parseHexColor } from "../src/color.js";
import { runViewerCli } from "../src/index.js";
import { flowPageHtml, type ViewerStep } from "../src/viewer-markup.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));

let ws: string;
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "burn-theme-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

/** True when the pixel's colour is within 4 per channel of `hex`. */
const isColour = (px: number[], hex: string): boolean =>
  [...parseHexColor(hex)!].every((c, i) => Math.abs(px[i]! - c) <= 4);

const writeConfig = (config: unknown) =>
  fs.writeFile(path.join(ws, ".docsxai.json"), JSON.stringify(config), "utf8");
const writeFile = async (rel: string, data: string | Buffer) => {
  await fs.mkdir(path.dirname(path.join(ws, rel)), { recursive: true });
  await fs.writeFile(path.join(ws, rel), data);
};
const messageOf = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: Error) => e.message,
  );

describe("loadBurnTheme", () => {
  it("is undefined without a config file, without a burn block and without a theme", async () => {
    expect(await loadBurnTheme(ws)).toBeUndefined();
    await writeConfig({ schema: "docsxai/workspace@1", app_url: "http://localhost:3000" });
    expect(await loadBurnTheme(ws)).toBeUndefined();
    await writeConfig({ schema: "docsxai/workspace@1", burn: {} });
    expect(await loadBurnTheme(ws)).toBeUndefined();
  });

  it("selects a preset by name", async () => {
    await writeConfig({ burn: { theme: { preset: "soft" } } });
    const loaded = await loadBurnTheme(ws);
    expect(loaded?.theme).toEqual({ ...THEME_PRESETS.soft, fontFile: null });
    expect(loaded?.warnings).toEqual([]);
  });

  it("reads the tokens file named by from, relative to the workspace", async () => {
    await writeFile("design/tokens.json", JSON.stringify({ color: { accent: "#0b6e4f" } }));
    await writeConfig({ burn: { theme: { from: "design/tokens.json", radius: 3 } } });
    const loaded = await loadBurnTheme(ws);
    expect(loaded?.theme.accent).toBe("#0b6e4f");
    expect(loaded?.theme.radius).toBe(3);
  });

  it("warns, without refusing, when the text pairs fall under AA", async () => {
    await writeConfig({ burn: { theme: { ink: "#aaaaaa" } } });
    const loaded = await loadBurnTheme(ws);
    expect(loaded?.warnings).toHaveLength(1);
    expect(loaded?.warnings[0]).toContain("ink on callout_background");
  });

  it("says which mapped token is missing, and from which file", async () => {
    await writeFile("tokens.json", JSON.stringify({ color: { accent: "#0b6e4f" } }));
    await writeConfig({ burn: { theme: { from: "tokens.json", tokens: { ink: "brand.ink" } } } });
    const message = await messageOf(loadBurnTheme(ws));
    expect(message).toBe(
      '.docsxai.json burn.theme: ink: burn.theme.tokens maps it to "brand.ink", but tokens.json has no such token',
    );
  });

  it("says when the tokens file is absent, escapes the workspace or is not JSON", async () => {
    await writeConfig({ burn: { theme: { from: "tokens.json" } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("from: tokens.json does not exist");
    await writeConfig({ burn: { theme: { from: "../tokens.json" } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain(
      '"../tokens.json" is outside the workspace',
    );
    await writeFile("tokens.json", "{ nope");
    await writeConfig({ burn: { theme: { from: "tokens.json" } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("tokens.json is not usable");
  });

  it("refuses a burn key it does not know, a burn block that is not an object and a config that is not JSON", async () => {
    await writeConfig({ burn: { colours: {} } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("colours: not a known key");
    await writeConfig({ burn: "clean" });
    expect(await messageOf(loadBurnTheme(ws))).toContain("must be an object");
    await fs.writeFile(path.join(ws, ".docsxai.json"), "{ nope", "utf8");
    expect(await messageOf(loadBurnTheme(ws))).toContain(".docsxai.json is not valid JSON");
  });

  it("throws a BurnThemeError that lists every problem of the block", async () => {
    await writeConfig({ burn: { theme: { accent: "red", radius: 99 } } });
    const error = await loadBurnTheme(ws).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BurnThemeError);
    expect((error as BurnThemeError).problems).toHaveLength(2);
    expect((error as Error).message).toContain(".docsxai.json burn.theme has 2 problems:");
  });
});

describe("a theme font", () => {
  it("is read from the workspace and drives the burned text", async () => {
    await writeFile("fonts/brand.ttf", FONT);
    await writeConfig({ burn: { theme: { font: "fonts/brand.ttf" } } });
    const theme = (await loadBurnTheme(ws))!.theme;
    expect(theme.fontFile).toBe(path.join(ws, "fonts", "brand.ttf"));
    const font = await loadThemeFont(theme);
    expect(font?.data.equals(FONT)).toBe(true);
    const { png } = await renderBurn({
      screenshotBuffer: solidPng(400, 300),
      annotations: [
        {
          step: "s",
          selector: "#a",
          bounding_box: { x: 150, y: 120, width: 80, height: 40 },
          copy: "Click Play",
        },
      ],
      options: { theme },
    });
    const img = decodePng(png);
    expect(isColour(pixelAt(img, 190, 121), "#e8590c")).toBe(true);
  });

  it("is refused when it is missing, not a font or a symlink", async () => {
    await writeConfig({ burn: { theme: { font: "fonts/brand.ttf" } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("does not exist");
    await writeFile("fonts/brand.ttf", "not a font at all, just text");
    expect(await messageOf(loadBurnTheme(ws))).toContain("is not a TrueType or OpenType font");
    await fs.rm(path.join(ws, "fonts", "brand.ttf"));
    await writeFile("fonts/real.ttf", FONT);
    await fs.symlink(path.join(ws, "fonts", "real.ttf"), path.join(ws, "fonts", "brand.ttf"));
    expect(await messageOf(loadBurnTheme(ws))).toContain("is a symlink");
  });
});

describe("docsxai-viewer burn with a theme in the workspace", () => {
  const annotations = {
    schema: "docsxai/annotations@1",
    annotations: [
      {
        step: "open-sidebar",
        selector: "#play",
        bounding_box: { x: 150, y: 120, width: 80, height: 40 },
        copy: "Click Play",
        index: 1,
      },
    ],
  };

  async function scaffold(config: unknown): Promise<void> {
    await writeConfig(config);
    await writeFile("docs/flow/annotations.json", JSON.stringify(annotations));
    await writeFile("docs/flow/screenshots/open-sidebar.png", solidPng(400, 300));
  }

  let out = "";
  let err = "";
  beforeEach(() => {
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
  });

  it("burns with the theme's accent", async () => {
    await scaffold({ burn: { theme: { preset: "high-contrast" } } });
    expect(await runViewerCli(["burn", ws])).toBe(0);
    expect(out).toContain("burn: wrote 1 image(s)");
    const img = decodePng(await fs.readFile(path.join(ws, "docs/flow/burned/open-sidebar.png")));
    expect(isColour(pixelAt(img, 190, 121), "#d10000")).toBe(true);
  });

  it("burns today's look when the workspace has no theme", async () => {
    await scaffold({ schema: "docsxai/workspace@1" });
    expect(await runViewerCli(["burn", ws])).toBe(0);
    const img = decodePng(await fs.readFile(path.join(ws, "docs/flow/burned/open-sidebar.png")));
    expect(isColour(pixelAt(img, 190, 121), "#e8590c")).toBe(true);
  });

  it("exits 1 and names the key when the block is wrong", async () => {
    await scaffold({ burn: { theme: { accent: "red" } } });
    expect(await runViewerCli(["burn", ws])).toBe(1);
    expect(err).toContain('burn: .docsxai.json burn.theme: accent: "red" is not a colour');
  });

  it("prints a contrast warning and still burns", async () => {
    await scaffold({ burn: { theme: { ink: "#bbbbbb" } } });
    expect(await runViewerCli(["burn", ws])).toBe(0);
    expect(err).toContain("burn: warning: burn.theme: ink on callout_background");
  });
});

describe("the viewer overlay", () => {
  const step: ViewerStep = {
    id: "open-sidebar",
    screenshot: "screenshots/open-sidebar.png",
    anns: [{ step: "open-sidebar", selector: "#play", copy: "Click Play" }],
    md: null,
  };
  const AT = "@docsxai/viewer 1.2.3";
  const clean = {
    ...THEME_PRESETS.clean,
    fontFile: null,
  };

  it("declares the theme as CSS variables after the stylesheet", () => {
    const html = flowPageHtml("flow", [step], AT, "", { theme: themeStyle(clean) });
    const vars = themeVariables(clean);
    expect(html).toContain(vars);
    expect(html.indexOf(vars)).toBeGreaterThan(html.indexOf(".sd-callout {"));
    expect(vars).toContain("--sd-accent: #2563eb;");
    expect(vars).toContain("--sd-accent-glow: rgba(37,99,235,0.35);");
    expect(vars).toContain("--sd-callout-bg: #ffffff;");
    expect(vars).toContain("--sd-callout-border: 1px solid #1f2937;");
    expect(vars).toContain("--sd-callout-shadow: 0px 2px 8px 0px rgba(17,24,39,0.18);");
    expect(vars).toContain("--sd-badge-radius: 6px;");
    expect(vars).toContain("--sd-connector: #1f2937;");
    expect(vars).toContain("--sd-callout-padding: 8px 12px;");
  });

  it("maps the default theme to the values the stylesheet falls back to", () => {
    const vars = themeVariables(DEFAULT_BURN_THEME);
    for (const declared of [
      "--sd-accent: #e8590c;",
      "--sd-accent-glow: rgba(232,89,12,0.35);",
      "--sd-accent-pulse: rgba(232,89,12,0.3);",
      "--sd-halo-radius: 4px;",
      "--sd-badge-fill: #c2410c;",
      "--sd-badge-radius: 11px;",
      "--sd-callout-radius: 7px;",
    ]) {
      expect(vars).toContain(declared);
    }
  });

  it("reads each variable with today's value as the fallback", () => {
    const html = flowPageHtml("flow", [step], AT, "");
    for (const fallback of [
      "var(--sd-accent, #e8590c)",
      "var(--sd-callout-bg, #1c1c1c)",
      "var(--sd-callout-ink, #fff)",
      "var(--sd-callout-radius, 7px)",
      "var(--sd-badge-fill, #c2410c)",
      "var(--sd-connector, #1c1c1c)",
    ]) {
      expect(html).toContain(fallback);
    }
    expect(html).not.toContain("--sd-accent: ");
  });

  it("keeps the content security policy unless the page embeds a font", () => {
    const plain = flowPageHtml("flow", [step], AT, "", { theme: themeStyle(clean) });
    expect(plain).not.toContain("font-src");
    const withFont = flowPageHtml("flow", [step], AT, "", { theme: themeStyle(clean, FONT) });
    expect(withFont).toContain(
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:",
    );
    expect(withFont).toContain(
      '@font-face { font-family: "docsxai-caption"; src: url(data:font/ttf;base64,',
    );
    expect(withFont).toContain("--sd-font:");
  });

  it("passes the same accessibility lint as a page without a theme", () => {
    const base = lintHtml(flowPageHtml("flow", [step], AT, ""));
    const themed = lintHtml(
      flowPageHtml("flow", [step], AT, "", { theme: themeStyle(clean, FONT) }),
    );
    expect(themed).toEqual(base);
  });
});
