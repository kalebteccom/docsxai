// `display_width` as a number (one width for every screenshot) or as { default, narrow,
// narrow_below } (a narrow width for screenshots under narrow_below px), and what captionScale
// makes of each.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BURN_THEME,
  NARROW_BELOW_DEFAULT,
  captionScale,
  displayWidthFor,
  type BurnTheme,
} from "../src/burn-theme.js";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";

const WORKSPACE = "/tmp/docsxai-theme-workspace";
const themeOf = (block: unknown): BurnTheme =>
  resolveBurnTheme(parseThemeConfig(block), { workspace: WORKSPACE });
const problemsOf = (block: unknown): string[] => {
  try {
    themeOf(block);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems;
  }
  throw new Error("the block was accepted");
};

const OBJECT = { default: 720, narrow: 358, narrow_below: 900 };
const auto = (display_width: unknown): BurnTheme => themeOf({ scale: "auto", display_width });

describe("display_width as an object", () => {
  it("carries the three numbers in the resolved theme", () => {
    expect(themeOf({ display_width: OBJECT })).toMatchObject({
      displayWidth: 720,
      displayWidthNarrow: 358,
      narrowBelow: 900,
    });
  });

  it("defaults narrow_below to 900 and default to the theme's width", () => {
    expect(NARROW_BELOW_DEFAULT).toBe(900);
    expect(themeOf({ display_width: { narrow: 358 } })).toMatchObject({
      displayWidth: 720,
      displayWidthNarrow: 358,
      narrowBelow: 900,
    });
    expect(themeOf({ display_width: { default: 640, narrow: 358 } }).displayWidth).toBe(640);
  });

  it("leaves display_width itself unset in the layer when the object has no default", () => {
    const { inline } = parseThemeConfig({ display_width: { narrow: 358 } });
    expect(inline).not.toHaveProperty("displayWidth");
    expect(inline).toMatchObject({ displayWidthNarrow: 358, narrowBelow: 900 });
  });

  it("picks narrow below the threshold and default at or above it", () => {
    const theme = auto(OBJECT);
    expect(displayWidthFor(theme, 780)).toBe(358);
    expect(displayWidthFor(theme, 899)).toBe(358);
    expect(displayWidthFor(theme, 900)).toBe(720);
    expect(displayWidthFor(theme, 1440)).toBe(720);
  });

  it("uses the 900 px threshold when none is written", () => {
    const theme = auto({ narrow: 358 });
    expect(displayWidthFor(theme, 899)).toBe(358);
    expect(displayWidthFor(theme, 900)).toBe(720);
  });

  it("honours a custom threshold", () => {
    const theme = auto({ narrow: 358, narrow_below: 500 });
    expect(displayWidthFor(theme, 499)).toBe(358);
    expect(displayWidthFor(theme, 780)).toBe(720);
  });

  it("gives an auto factor of about 2.18 for 780 px at narrow 358", () => {
    expect(captionScale(auto(OBJECT), 780)).toBe(2.18);
  });

  it("gives a 1440 px screenshot the default width's factor", () => {
    expect(captionScale(auto(OBJECT), 1440)).toBe(2);
  });

  it("does not change an explicit scale", () => {
    expect(captionScale(themeOf({ scale: 2, display_width: OBJECT }), 780)).toBe(2);
  });
});

describe("display_width as a number", () => {
  it("leaves the narrow pair empty and behaves as before", () => {
    const theme = auto(358);
    expect(theme).toMatchObject({ displayWidth: 358, displayWidthNarrow: null, narrowBelow: null });
    expect(displayWidthFor(theme, 100)).toBe(358);
    expect(captionScale(theme, 780)).toBe(2.18);
    expect(captionScale(auto(720), 390)).toBe(1);
  });

  it("is what a theme without the keys has", () => {
    expect(DEFAULT_BURN_THEME).toMatchObject({ displayWidthNarrow: null, narrowBelow: null });
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: "auto" }, 1440)).toBe(2);
  });

  it("clears an object written by a lower layer", () => {
    const base = themeOf({ display_width: OBJECT });
    const merged = { ...base, ...parseThemeConfig({ display_width: 600 }).inline };
    expect(merged).toMatchObject({ displayWidth: 600, displayWidthNarrow: null });
  });
});

describe("bad display_width shapes", () => {
  it.each([
    [{ narrow: -5 }, "display_width.narrow: -5 is not a positive number"],
    [{ narrow: 0 }, "display_width.narrow: 0 is not a positive number"],
    [{ narrow: "358" }, 'display_width.narrow: "358" is not a number'],
    [{ default: 0, narrow: 358 }, "display_width.default: 0 is not a positive number"],
    [{ default: "x", narrow: 358 }, 'display_width.default: "x" is not a number'],
    [{ narrow: 358, narrow_below: 0 }, "display_width.narrow_below: 0 is not a positive number"],
    [{ narrow: 358, narrow_below: -900 }, "display_width.narrow_below: -900 is not a positive"],
    [{ narrow: 358, narrow_below: null }, "display_width.narrow_below: null is not a number"],
    [{ default: 720 }, 'display_width.narrow: needs a "narrow" width'],
    [{}, 'display_width.narrow: needs a "narrow" width'],
  ])("refuses %j with its key path", (value, message) => {
    expect(problemsOf({ display_width: value })).toEqual([expect.stringContaining(message)]);
  });

  it("lists unknown keys and the keys it knows", () => {
    expect(problemsOf({ display_width: { narrow: 358, wide: 1, narrowBelow: 900 } })).toEqual([
      'display_width: unknown keys "wide", "narrowBelow"; the keys are default, narrow, narrow_below',
    ]);
    expect(problemsOf({ display_width: { narrow: 358, wide: 1 } })[0]).toContain(
      'unknown key "wide"',
    );
  });

  it.each([[[]], [[358]], ["358"], [true], [null]])("refuses %j and shows the object form", (v) => {
    const [problem] = problemsOf({ display_width: v });
    expect(problem).toContain("display_width: ");
    expect(problem).toContain('{ "default": 720, "narrow": 358, "narrow_below": 900 }');
  });

  it("keeps the number range message for a number", () => {
    expect(problemsOf({ display_width: 239 })).toEqual([
      "display_width: 239 is outside the range 240 to 2400",
    ]);
  });

  it("reports the first bad part of an object", () => {
    expect(problemsOf({ display_width: { narrow: -1, narrow_below: -2 } })[0]).toContain(
      "display_width.narrow:",
    );
  });
});
