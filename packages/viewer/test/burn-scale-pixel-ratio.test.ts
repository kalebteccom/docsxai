// The caption scale follows the capture's pixel ratio: a 2x capture with no `burn.theme`, a preset
// with no `scale`, or `scale: "auto"` gets a caption of the same CSS size as the 1x capture. An
// explicit number stays as written (`scale: 1` keeps the old 2x look). 1x output is unchanged.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME, THEME_PRESETS, captionScale } from "../src/burn-theme.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("captionScale and the pixel ratio", () => {
  it("is the pixel ratio for the default theme", () => {
    expect(captionScale(DEFAULT_BURN_THEME, 1280)).toBe(1);
    expect(captionScale(DEFAULT_BURN_THEME, 2560, 2)).toBe(2);
    expect(captionScale(DEFAULT_BURN_THEME, 1920, 1.5)).toBe(1.5);
  });

  it("is the pixel ratio for a preset that sets no auto scale", () => {
    expect(captionScale({ ...DEFAULT_BURN_THEME, ...THEME_PRESETS.clean }, 2560, 2)).toBe(2);
  });

  it("keeps an explicit number as written", () => {
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: 1 }, 2560, 2)).toBe(1);
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: 1.5 }, 2560, 2)).toBe(1.5);
  });

  it("never goes under the pixel ratio for auto, so a 2x capture is twice the 1x one", () => {
    const auto = { ...DEFAULT_BURN_THEME, scale: "auto" as const };
    expect(captionScale(auto, 390)).toBe(1);
    expect(captionScale(auto, 780, 2)).toBe(2);
    expect(captionScale(auto, 1440)).toBe(2);
    expect(captionScale(auto, 2880, 2)).toBe(4);
  });

  it("caps auto at four times the pixel ratio", () => {
    const auto = { ...DEFAULT_BURN_THEME, scale: "auto" as const, displayWidth: 360 };
    expect(captionScale(auto, 2000)).toBe(4);
    expect(captionScale(auto, 4000, 2)).toBe(8);
  });
});

describe("an unthemed burn and the pixel ratio", () => {
  const records = (f: number): AnnotationRecord[] => [
    {
      step: "s",
      selector: "#play",
      bounding_box: { x: 150 * f, y: 360 * f, width: 240 * f, height: 120 * f },
      copy: "Click Play to open the recap sidebar",
      index: 1,
    },
  ];
  const burn = (f: number) =>
    renderBurn({
      screenshotBuffer: solidPng(1200 * f, 900 * f),
      annotations: records(f),
      ...(f === 1 ? {} : { options: { pixelRatio: f } }),
    });

  // The bytes depend on the satori version: this hash is the locked satori 0.63.2, the same at
  // origin/main and after the themed margin and connector rules. A stale install with satori 0.33.5
  // renders 569d254d…. On a mismatch, reinstall from the lockfile and run again.
  it("leaves a 1x burn byte for byte as it was", async () => {
    const { png, report } = await burn(1);
    expect(sha(png)).toBe("8071634bcd28cdfac0adc9767fc9a41e13db7b0582f1240dee2a32c99dcd0a06");
    expect(report[0]!.callout).toEqual({ x: 131.5, y: 313, width: 277, height: 37 });
  });

  it("draws a 2x caption twice the size of the 1x one, at the same CSS place", async () => {
    const one = (await burn(1)).report[0]!;
    const two = (await burn(2)).report[0]!;
    const c1 = one.callout!;
    expect(two.callout).toEqual({
      x: c1.x * 2,
      y: c1.y * 2,
      width: c1.width * 2,
      height: c1.height * 2,
    });
    expect(two.badge!.width).toBe(one.badge!.width * 2);
  });
});
