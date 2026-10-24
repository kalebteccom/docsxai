import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AA_TEXT_RATIO,
  DEFAULT_BURN_THEME,
  THEME_PRESETS,
  THEME_PRESET_NAMES,
  contrastWarnings,
  haloRadius,
  themeContrast,
  type BurnTheme,
} from "../src/burn-theme.js";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { THEME_FIELDS, THEME_KEYS, parseShadow } from "../src/burn-theme-fields.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";
import { contrastRatio, normaliseHex, rgbaOf } from "../src/color.js";
import { BADGE_FILL } from "../src/viewer-style.js";

const WORKSPACE = path.resolve("/tmp/docsxai-theme-workspace");

/** The theme a block resolves to; the tokens file, when there is one, is passed as a parsed document. */
function themeOf(block: unknown, tokens?: unknown): BurnTheme {
  const config = parseThemeConfig(block);
  return resolveBurnTheme(config, {
    workspace: WORKSPACE,
    ...(tokens !== undefined ? { tokens: flattenTokens(tokens) } : {}),
  });
}

/** The problems a block is refused for. */
function problemsOf(block: unknown, tokens?: unknown): string[] {
  try {
    themeOf(block, tokens);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems;
  }
  throw new Error("the block was accepted");
}

describe("the default theme", () => {
  it("holds the values burn.ts hard-coded before themes", () => {
    expect(DEFAULT_BURN_THEME).toEqual({
      accent: "#e8590c",
      ink: "#1c1c1c",
      calloutBackground: "#fff",
      calloutBorderColor: "#1c1c1c",
      calloutBorderWidth: 1,
      radius: 7,
      shadow: null,
      badgeShape: "circle",
      badgeFill: BADGE_FILL,
      fontSize: 14,
      lineHeight: 19,
      paddingX: 11,
      paddingY: 8,
      fontFile: null,
      fontWeight: 400,
      connectorStyle: "auto",
      arrowSize: 8,
      maxWidthRatio: 0.62,
      scale: 1,
      displayWidth: 720,
      displayWidthNarrow: null,
      narrowBelow: null,
    });
  });

  it("derives the halo radius and glow the burner used to hard-code", () => {
    expect(haloRadius(DEFAULT_BURN_THEME)).toBe(4);
    expect(rgbaOf(DEFAULT_BURN_THEME.accent, 0.35)).toBe("rgba(232,89,12,0.35)");
  });

  it("is what an empty block resolves to", () => {
    expect(themeOf({})).toEqual(DEFAULT_BURN_THEME);
  });
});

describe("presets", () => {
  it("are clean, soft, high-contrast and readable", () => {
    expect([...THEME_PRESET_NAMES]).toEqual(["clean", "soft", "high-contrast", "readable"]);
  });

  it.each(THEME_PRESET_NAMES)(
    "%s sets every field but the font, so it differs from the default",
    (name) => {
      const theme = themeOf({ preset: name });
      expect(theme).toEqual({ ...THEME_PRESETS[name], fontFile: null });
      expect(theme.accent).not.toBe(DEFAULT_BURN_THEME.accent);
    },
  );

  it.each(THEME_PRESET_NAMES)("%s meets WCAG AA for its text pairs", (name) => {
    const theme = themeOf({ preset: name });
    for (const check of themeContrast(theme)) {
      expect(check.ratio, `${name}: ${check.pair}`).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    }
    expect(contrastWarnings(theme)).toEqual([]);
  });

  it("high-contrast is black on white, well past AA", () => {
    const theme = themeOf({ preset: "high-contrast" });
    expect(contrastRatio(theme.ink, theme.calloutBackground)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", theme.badgeFill)).toBeGreaterThanOrEqual(7);
    expect(theme.calloutBorderWidth).toBeGreaterThanOrEqual(2);
  });

  it("keep the default look's own pairs at AA", () => {
    expect(contrastWarnings(DEFAULT_BURN_THEME)).toEqual([]);
  });

  it("let any field be overridden on top", () => {
    const theme = themeOf({ preset: "soft", accent: "#00796b", radius: 2, shadow: "none" });
    expect(theme.accent).toBe("#00796b");
    expect(theme.radius).toBe(2);
    expect(theme.shadow).toBeNull();
    expect(theme.badgeFill).toBe(THEME_PRESETS.soft.badgeFill);
  });

  it("refuse an unknown name and list the real ones", () => {
    expect(problemsOf({ preset: "bold" })).toEqual([
      'preset: "bold" is not a preset; use one of clean, soft, high-contrast, readable',
    ]);
  });
});

describe("layering", () => {
  it("keeps the callout outline on the ink colour until something sets the outline", () => {
    expect(themeOf({ ink: "#000000" }).calloutBorderColor).toBe("#000000");
    expect(themeOf({ ink: "#000000", callout_border_color: "#336699" }).calloutBorderColor).toBe(
      "#336699",
    );
    expect(themeOf({ preset: "soft", ink: "#000000" }).calloutBorderColor).toBe(
      THEME_PRESETS.soft.calloutBorderColor,
    );
  });

  it("puts keys in the block above the tokens file, and the tokens file above the preset", () => {
    const tokens = { color: { accent: "#111111", ink: "#222222" } };
    const theme = themeOf({ preset: "clean", from: "tokens.json", accent: "#333333" }, tokens);
    expect(theme.accent).toBe("#333333");
    expect(theme.ink).toBe("#222222");
    expect(theme.badgeFill).toBe(THEME_PRESETS.clean.badgeFill);
  });

  it("stores a colour as lowercase #rrggbb", () => {
    expect(themeOf({ accent: "#ABC" }).accent).toBe("#aabbcc");
    expect(normaliseHex("#FFF")).toBe("#ffffff");
  });
});

describe("validation", () => {
  it("names the key and the fix for every bad value, all at once", () => {
    expect(
      problemsOf({
        accent: "red",
        radius: 40,
        font_size: "14px",
        badge_shape: "star",
        callout_border_width: -1,
      }),
    ).toEqual([
      'accent: "red" is not a colour; use #rgb or #rrggbb',
      "radius: 40 is outside the range 0 to 24",
      'font_size: "14px" is not a number; write a plain number of px, without a unit',
      'badge_shape: "star" is not one of circle, rounded, square',
      "callout_border_width: -1 is outside the range 0 to 6",
    ]);
  });

  it("joins several problems under one heading and prints one problem inline", () => {
    let message = "";
    try {
      themeOf({ accent: "red", ink: "blue" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^burn\.theme has 2 problems:\n {2}- accent: /);
    expect(() => themeOf({ accent: "red" })).toThrow(/^burn\.theme: accent: "red" is not a colour/);
  });

  it("suggests the snake_case key for a camelCase or near-miss spelling", () => {
    const [camel] = problemsOf({ calloutBackground: "#ffffff" });
    expect(camel).toContain('did you mean "callout_background"?');
    const [typo] = problemsOf({ acent: "#ffffff" });
    expect(typo).toContain('did you mean "accent"?');
  });

  it("refuses a block that is not an object", () => {
    expect(() => parseThemeConfig("clean")).toThrow(/must be an object/);
    expect(() => parseThemeConfig([])).toThrow(/must be an object/);
  });

  it("refuses a line height below the font size", () => {
    expect(problemsOf({ font_size: 20, line_height: 12 })).toEqual([
      "line_height: 12 is smaller than font_size 20; lines would overlap",
    ]);
  });

  it("refuses a font that is not a TTF or OTF, or leaves the workspace", () => {
    expect(problemsOf({ font: "brand.woff2" })).toEqual([
      'font: "brand.woff2" is not a .ttf or .otf file',
    ]);
    expect(problemsOf({ font: "/etc/fonts/brand.ttf" })[0]).toContain("inside the workspace");
    expect(problemsOf({ font: "../outside/brand.ttf" })).toEqual([
      'font: "../outside/brand.ttf" is outside the workspace',
    ]);
  });

  it("resolves a font to an absolute path under the workspace", () => {
    expect(themeOf({ font: "fonts/brand.TTF" }).fontFile).toBe(
      path.join(WORKSPACE, "fonts", "brand.TTF"),
    );
  });

  it("has a field for every documented key", () => {
    expect(THEME_KEYS).toEqual([
      "accent",
      "ink",
      "callout_background",
      "callout_border_color",
      "callout_border_width",
      "radius",
      "shadow",
      "badge_shape",
      "badge_fill",
      "font_size",
      "line_height",
      "padding_x",
      "padding_y",
      "font",
      "font_weight",
      "connector_style",
      "arrow_size",
      "max_width_ratio",
      "scale",
      "display_width",
    ]);
    // render-only keys (max_width_ratio, scale, display_width) have no default token path
    const tokens = THEME_KEYS.map((k) => (THEME_FIELDS[k] as { token?: string }).token).filter(
      (t): t is string => t !== undefined,
    );
    expect(tokens).toHaveLength(THEME_KEYS.length - 3);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("contrast warnings", () => {
  it("name the pair and both numbers when text falls under AA", () => {
    const theme = themeOf({ ink: "#999999", callout_background: "#ffffff" });
    const [warning] = contrastWarnings(theme);
    expect(warning).toContain("ink on callout_background");
    expect(warning).toContain("2.85:1");
    expect(warning).toContain("WCAG AA needs 4.5:1");
  });

  it("flag a badge fill that is too light for its white digits", () => {
    expect(contrastWarnings(themeOf({ badge_fill: "#ffcc00" }))[0]).toContain(
      "white digits on badge_fill",
    );
  });
});

describe("shadow", () => {
  it.each([
    ["none", null],
    ["  ", null],
    ["0 2px 8px rgba(17, 24, 39, .18)", "0px 2px 8px 0px rgba(17,24,39,0.18)"],
    ["1px 1px #000", "1px 1px 0px 0px #000000"],
    [
      "0 4px 12px 2px #ABC, 0 0 0 1px rgb(0, 0, 0)",
      "0px 4px 12px 2px #aabbcc, 0px 0px 0px 1px rgb(0,0,0)",
    ],
  ])("canonicalises %j", (input, expected) => {
    expect(parseShadow(input)).toBe(expected);
  });

  it.each([
    ["0 2px", "must be"],
    ["0 2px 8px red", "is not #rgb"],
    ["0 2px 900px #000", "blur"],
    ["inset 0 2px 8px #000", "must be"],
    ["0 0 0 #000, 0 0 0 #000, 0 0 0 #000, 0 0 0 #000", "at most 3"],
    ["0 0 0 #000; } body { display: none", "must be"],
  ])("refuses %j", (input, why) => {
    expect(() => parseShadow(input)).toThrow(why);
  });

  it("is a canonical string every preset already uses", () => {
    for (const name of THEME_PRESET_NAMES) {
      const { shadow } = THEME_PRESETS[name];
      if (shadow !== null) expect(parseShadow(shadow)).toBe(shadow);
    }
  });
});
