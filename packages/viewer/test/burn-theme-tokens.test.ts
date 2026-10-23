import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { THEME_FIELDS, THEME_KEYS, type ThemeField } from "../src/burn-theme-fields.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";

const WORKSPACE = path.resolve("/tmp/docsxai-theme-workspace");

function themeFrom(block: unknown, tokens: unknown) {
  return resolveBurnTheme(parseThemeConfig(block), {
    workspace: WORKSPACE,
    tokens: flattenTokens(tokens),
  });
}

function problemsFrom(block: unknown, tokens: unknown): string[] {
  try {
    themeFrom(block, tokens);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems;
  }
  throw new Error("the block was accepted");
}

/** A W3C design-tokens file with a token for every theme key, one of them an alias. */
const W3C = {
  color: {
    brand: { $value: "#0057b8", $type: "color" },
    accent: { $value: "{color.brand}", $type: "color" },
    ink: { $value: "#101820", $type: "color" },
    callout: {
      background: { $value: "#f4f8fc", $type: "color" },
      border: { $value: { colorSpace: "srgb", components: [0, 0.34, 0.72], hex: "#0057b8" } },
    },
    badge: { background: { $value: "#003f88", $type: "color" } },
  },
  border: { callout: { width: { $value: "2px", $type: "dimension" } } },
  radius: { callout: { $value: { value: 0.75, unit: "rem" }, $type: "dimension" } },
  shadow: {
    callout: {
      $type: "shadow",
      $value: {
        color: "rgba(0, 0, 0, 0.25)",
        offsetX: "0px",
        offsetY: "4px",
        blur: "12px",
        spread: "0px",
      },
    },
  },
  shape: { badge: { $value: "square" } },
  font: {
    size: { caption: { $value: "15px", $type: "dimension" } },
    "line-height": { caption: { $value: 22, $type: "dimension" } },
    file: { $value: "fonts/brand.otf" },
  },
  space: { callout: { x: { $value: "12px" }, y: { $value: "9px" } } },
};

describe("a W3C tokens file", () => {
  it("fills every theme key from its default path, following aliases", () => {
    const theme = themeFrom({ from: "tokens.json" }, W3C);
    expect(theme).toMatchObject({
      accent: "#0057b8",
      ink: "#101820",
      calloutBackground: "#f4f8fc",
      calloutBorderColor: "#0057b8",
      calloutBorderWidth: 2,
      radius: 12,
      shadow: "0px 4px 12px 0px rgba(0,0,0,0.25)",
      badgeShape: "square",
      badgeFill: "#003f88",
      fontSize: 15,
      lineHeight: 22,
      paddingX: 12,
      paddingY: 9,
    });
    expect(theme.fontFile).toBe(path.join(WORKSPACE, "fonts", "brand.otf"));
  });

  it("reads a shadow written as a list of layers", () => {
    const tokens = {
      shadow: {
        callout: {
          $value: [
            { color: "#00000033", offsetX: 0, offsetY: 1, blur: 2, spread: 0 },
            { color: "#000", offsetX: "0px", offsetY: "8px", blur: "16px", spread: "-2px" },
          ],
        },
      },
    };
    expect(() => themeFrom({ from: "tokens.json" }, tokens)).toThrow(/shadow colour "#00000033"/);
    const ok = {
      shadow: {
        callout: {
          $value: [
            { color: "#000", offsetX: 0, offsetY: 1, blur: 2, spread: 0 },
            { color: "#000", offsetX: "0px", offsetY: "8px", blur: "16px", spread: "-2px" },
          ],
        },
      },
    };
    expect(themeFrom({ from: "tokens.json" }, ok).shadow).toBe(
      "0px 1px 2px 0px #000000, 0px 8px 16px -2px #000000",
    );
  });
});

describe("a plain tokens map", () => {
  it("reads nested groups", () => {
    const theme = themeFrom(
      { from: "tokens.json" },
      { color: { accent: "#cc3300", ink: "#222222" } },
    );
    expect(theme.accent).toBe("#cc3300");
    expect(theme.ink).toBe("#222222");
  });

  it("reads flat dotted keys", () => {
    const theme = themeFrom(
      { from: "tokens.json" },
      { "color.accent": "#cc3300", "radius.callout": 10, "font.size.caption": "0.875rem" },
    );
    expect(theme.accent).toBe("#cc3300");
    expect(theme.radius).toBe(10);
    expect(theme.fontSize).toBe(14);
  });

  it("leaves a key the file does not define at the preset or default", () => {
    const theme = themeFrom(
      { preset: "soft", from: "tokens.json" },
      { color: { accent: "#cc3300" } },
    );
    expect(theme.accent).toBe("#cc3300");
    expect(theme.radius).toBe(12);
  });
});

describe("burn.theme.tokens", () => {
  it("maps a key to another path and reads it from there", () => {
    const theme = themeFrom(
      { from: "tokens.json", tokens: { accent: "brand.primary" } },
      { brand: { primary: "#aa0000" }, color: { accent: "#00aa00" } },
    );
    expect(theme.accent).toBe("#aa0000");
  });

  it("is an error when a mapped token is missing", () => {
    expect(
      problemsFrom(
        { from: "tokens.json", tokens: { accent: "brand.primary", ink: "brand.ink" } },
        { brand: { primary: "#aa0000" } },
      ),
    ).toEqual(['ink: burn.theme.tokens maps it to "brand.ink", but tokens.json has no such token']);
  });

  it("is an error to map a key that is not a theme key, or without a file", () => {
    expect(() => parseThemeConfig({ from: "t.json", tokens: { colour: "a.b" } })).toThrow(
      /tokens\.colour: not a theme key/,
    );
    expect(() => parseThemeConfig({ tokens: { accent: 3 } })).toThrow(
      /tokens\.accent: must be a token path/,
    );
    expect(
      (() => {
        try {
          return resolveBurnTheme(parseThemeConfig({ tokens: { accent: "a.b" } }), {
            workspace: WORKSPACE,
          });
        } catch (e) {
          return (e as BurnThemeError).problems;
        }
      })(),
    ).toEqual(['tokens: maps theme keys to a tokens file, so "from" must name that file']);
  });
});

describe("a tokens file that does not fit", () => {
  it("names the token and the key when a value is not valid for it", () => {
    expect(problemsFrom({ from: "tokens.json" }, { color: { accent: "teal" } })).toEqual([
      'accent: token "color.accent" in tokens.json: "teal" is not a colour; use #rgb or #rrggbb',
    ]);
  });

  it("reports an alias that points nowhere, and one that loops", () => {
    expect(
      problemsFrom({ from: "tokens.json" }, { color: { accent: "{color.nope}" } })[0],
    ).toContain("alias {color.nope} is not defined");
    const loop = { color: { accent: "{color.ink}", ink: "{color.accent}" } };
    expect(problemsFrom({ from: "tokens.json" }, loop)[0]).toContain("alias cycle");
  });

  it("is an error when the file has none of the tokens the theme reads", () => {
    const [problem] = problemsFrom({ from: "tokens.json" }, { spacing: { small: "4px" } });
    expect(problem).toContain("tokens.json has none of the tokens burn.theme reads");
    expect(problem).toContain("color.accent");
  });

  it("is an error when the document is not an object", () => {
    expect(() => flattenTokens([])).toThrow(/must be a JSON object/);
    expect(() => flattenTokens("#fff")).toThrow(/must be a JSON object/);
  });

  it("refuses a dimension in a unit it cannot convert", () => {
    expect(problemsFrom({ from: "tokens.json" }, { radius: { callout: "2em" } })[0]).toContain(
      '"2em" is not a number',
    );
  });
});

describe("the mapping table", () => {
  it("has one default token path per theme key", () => {
    const table = THEME_KEYS.flatMap((k) => {
      const token = (THEME_FIELDS[k] as ThemeField).token;
      return token === undefined ? [] : [[k, token]];
    });
    expect(table).toEqual([
      ["accent", "color.accent"],
      ["ink", "color.ink"],
      ["callout_background", "color.callout.background"],
      ["callout_border_color", "color.callout.border"],
      ["callout_border_width", "border.callout.width"],
      ["radius", "radius.callout"],
      ["shadow", "shadow.callout"],
      ["badge_shape", "shape.badge"],
      ["badge_fill", "color.badge.background"],
      ["font_size", "font.size.caption"],
      ["line_height", "font.line-height.caption"],
      ["padding_x", "space.callout.x"],
      ["padding_y", "space.callout.y"],
      ["font", "font.file"],
      ["font_weight", "font.weight.caption"],
      ["arrow_size", "size.callout.arrow"],
    ]);
  });

  it("leaves render settings with no default token path", () => {
    const bare = THEME_KEYS.filter((k) => (THEME_FIELDS[k] as ThemeField).token === undefined);
    expect(bare).toEqual(["max_width_ratio", "scale", "display_width"]);
  });
});
