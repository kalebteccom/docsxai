// Tokens-file edges: values of the wrong type, dimension units, aliases, shadows written as
// layers, a mapped token that is a group, sizing keys read from a tokens file, nesting depth.

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";

const WORKSPACE = path.resolve("/tmp/docsxai-theme-workspace");
const FROM = { from: "tokens.json" };

const themeFrom = (block: unknown, tokens: unknown) =>
  resolveBurnTheme(parseThemeConfig(block), {
    workspace: WORKSPACE,
    tokens: flattenTokens(tokens),
  });

const problemsFrom = (block: unknown, tokens: unknown): string[] => {
  try {
    themeFrom(block, tokens);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems;
  }
  throw new Error("the block was accepted");
};

describe("a token of the wrong type", () => {
  it("names a number, a boolean and a null where a colour is expected", () => {
    const accent = (value: unknown) => problemsFrom(FROM, { color: { accent: value } })[0];
    expect(accent(42)).toBe(
      'accent: token "color.accent" in tokens.json: 42 is not a colour; use #rgb or #rrggbb',
    );
    expect(accent(true)).toContain("true is not a colour");
    expect(accent(null)).toContain("null is not a colour");
  });

  it("names a boolean where a dimension is expected", () => {
    const [problem] = problemsFrom(FROM, { radius: { callout: true } });
    expect(problem).toContain(
      'radius: token "radius.callout" in tokens.json: true is not a number',
    );
  });

  it("refuses a colour object without a hex string", () => {
    const [problem] = problemsFrom(FROM, {
      color: { accent: { $value: { colorSpace: "srgb", components: [0, 0, 1] } } },
    });
    expect(problem).toContain('accent: token "color.accent"');
    expect(problem).toContain("is not a colour");
  });

  it("lists every bad token, in the order of the theme keys", () => {
    const problems = problemsFrom(FROM, {
      color: { accent: 42, ink: true },
      radius: { callout: 99 },
    });
    expect(problems.map((p) => p.split(":")[0])).toEqual(["accent", "ink", "radius"]);
  });

  it("refuses a font weight written as a string that is not 400 or 600", () => {
    expect(problemsFrom(FROM, { font: { weight: { caption: "700" } } })[0]).toContain(
      '"700" is not a supported weight',
    );
    expect(themeFrom(FROM, { font: { weight: { caption: 600 } } }).fontWeight).toBe(600);
    expect(themeFrom(FROM, { font: { weight: { caption: "600" } } }).fontWeight).toBe(600);
  });
});

describe("a mapped token", () => {
  it("is missing when the path names a group", () => {
    expect(
      problemsFrom({ ...FROM, tokens: { accent: "color" } }, { color: { accent: "#0b6e4f" } }),
    ).toEqual(['accent: burn.theme.tokens maps it to "color", but tokens.json has no such token']);
  });

  it("reads the sizing keys, which have no default path", () => {
    const theme = themeFrom(
      { ...FROM, tokens: { scale: "caption.scale", display_width: "page.width" } },
      { color: { accent: "#0b6e4f" }, caption: { scale: 2 }, page: { width: "600px" } },
    );
    expect(theme).toMatchObject({ scale: 2, displayWidth: 600, accent: "#0b6e4f" });
    const auto = themeFrom(
      { ...FROM, tokens: { scale: "caption.scale" } },
      { caption: { scale: "auto" } },
    );
    expect(auto.scale).toBe("auto");
  });

  it("ignores a scale and a display_width in the file unless they are mapped", () => {
    const theme = themeFrom(FROM, { color: { accent: "#0b6e4f" }, scale: 3, display_width: 300 });
    expect(theme).toMatchObject({ scale: 1, displayWidth: 720 });
  });

  it("applies the sizing range to a mapped token", () => {
    expect(
      problemsFrom({ ...FROM, tokens: { scale: "caption.scale" } }, { caption: { scale: 9 } })[0],
    ).toBe('scale: token "caption.scale" in tokens.json: 9 is outside the range 0.5 to 4');
  });
});

describe("dimension tokens", () => {
  const tokensOf = (value: unknown) => ({ radius: { callout: { $value: value } } });
  const radius = (value: unknown) => themeFrom(FROM, tokensOf(value)).radius;

  it("read a bare number string, rem, a padded string and a W3C dimension object", () => {
    expect(radius("14")).toBe(14);
    expect(radius("0.5rem")).toBe(8);
    expect(radius(" 6px ")).toBe(6);
    expect(radius({ value: 1, unit: "rem" })).toBe(16);
    expect(radius({ value: 5 })).toBe(5);
  });

  it("refuse a unit that is not px or rem, an object with a string value and exponent notation", () => {
    for (const value of [{ value: 12, unit: "em" }, { value: "12", unit: "px" }, "1e1px", "2em"]) {
      expect(problemsFrom(FROM, tokensOf(value))[0]).toContain('radius: token "radius.callout"');
    }
  });

  it("refuse a negative value with the key's range", () => {
    expect(problemsFrom(FROM, tokensOf("-3px"))[0]).toContain("-3 is outside the range 0 to 24");
  });
});

describe("aliases", () => {
  it("follow a chain of three, and an alias padded with spaces", () => {
    const tokens = {
      base: { brand: "#0b6e4f" },
      color: { primary: "{base.brand}", accent: " {color.primary} " },
    };
    expect(themeFrom(FROM, tokens).accent).toBe("#0b6e4f");
  });

  it("resolve to a number as well as a string", () => {
    expect(themeFrom(FROM, { base: { r: 6 }, radius: { callout: "{base.r}" } }).radius).toBe(6);
  });

  it("report a token that points at itself", () => {
    expect(problemsFrom(FROM, { color: { accent: "{color.accent}" } })[0]).toContain(
      "alias cycle color.accent -> color.accent",
    );
  });

  it("resolve inside a shadow layer", () => {
    const tokens = {
      color: { ink: "#101820" },
      shadow: {
        callout: {
          $value: { color: "{color.ink}", offsetX: 0, offsetY: "2px", blur: "4px", spread: "0px" },
        },
      },
    };
    expect(themeFrom(FROM, tokens).shadow).toBe("0px 2px 4px 0px #101820");
  });
});

describe("shadow tokens", () => {
  const shadow = (value: unknown) => ({ shadow: { callout: { $value: value } } });
  const layer = { color: "#000000", offsetX: 0, offsetY: 4, blur: 8, spread: 0 };

  it("take an empty list of layers as no shadow, over the preset's", () => {
    expect(themeFrom({ ...FROM, preset: "clean" }, shadow([])).shadow).toBeNull();
  });

  it("join several layers and refuse four", () => {
    expect(themeFrom(FROM, shadow([layer, { ...layer, blur: 16 }])).shadow).toBe(
      "0px 4px 8px 0px #000000, 0px 4px 16px 0px #000000",
    );
    expect(problemsFrom(FROM, shadow([layer, layer, layer, layer]))[0]).toContain(
      "4 shadow layers; at most 3 are allowed",
    );
  });

  it("name a layer whose offsets are not numbers", () => {
    expect(problemsFrom(FROM, shadow({ ...layer, offsetX: "far" }))[0]).toContain(
      "a shadow layer needs numeric offsetX, offsetY, blur and spread",
    );
  });

  it("report a layer without a colour as a problem", () => {
    const bare = { offsetX: 0, offsetY: 4, blur: 8, spread: 0 };
    expect(problemsFrom(FROM, shadow(bare))[0]).toContain('shadow: token "shadow.callout"');
  });
});

describe("flattenTokens", () => {
  it("skips $-keys of a group and ignores children of a token", () => {
    const leaves = flattenTokens({
      $description: "brand",
      color: {
        $type: "color",
        $extensions: { note: "x" },
        accent: { $value: "#fff", child: { $value: "#000" } },
      },
    });
    expect([...leaves.keys()]).toEqual(["color.accent"]);
  });

  it("merges flat dotted keys with nested groups", () => {
    const leaves = flattenTokens({ "color.accent": "#e8590c", color: { ink: "#111111" } });
    expect([...leaves.keys()].sort()).toEqual(["color.accent", "color.ink"]);
  });

  it("reads 16 levels and refuses 17", () => {
    const nested = (levels: number): unknown => {
      let doc: unknown = "#ffffff";
      for (let i = 0; i < levels; i++) doc = { a: doc };
      return doc;
    };
    expect(flattenTokens(nested(16)).size).toBe(1);
    expect(() => flattenTokens(nested(17))).toThrow(/tokens nest deeper than 16 levels at "a\.a/);
  });

  it("reads an empty object as no tokens", () => {
    expect(flattenTokens({}).size).toBe(0);
  });
});
