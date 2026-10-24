// A pixelRatio that is no number from 1 to 4 stops the burn with a message. With `scale: "auto"`,
// 0 used to end in "Invalid typed array length: Infinity", and NaN or a negative ratio burned silently.

import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME } from "../src/burn-theme.js";
import { solidPng } from "./helpers/png.js";

const burn = (pixelRatio: number, scale: "auto" | number = "auto") =>
  renderBurn({
    screenshotBuffer: solidPng(400, 300),
    annotations: [
      {
        step: "s",
        selector: "#a",
        copy: "Hello",
        bounding_box: { x: 100, y: 100, width: 80, height: 30 },
        index: 1,
      },
    ],
    options: { theme: { ...DEFAULT_BURN_THEME, scale }, pixelRatio, warn: () => {} },
  });

describe("renderBurn pixelRatio", () => {
  it.each([0, -1, NaN, Infinity, 4.5, 0.5])("rejects %s", async (ratio) => {
    await expect(burn(ratio)).rejects.toThrow(/pixelRatio must be a number from 1 to 4/);
  });

  it.each([1, 1.5, 2, 4])("accepts %s", async (ratio) => {
    await expect(burn(ratio, 1)).resolves.toBeDefined();
  });
});
