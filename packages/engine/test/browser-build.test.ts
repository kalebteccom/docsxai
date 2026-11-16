import { describe, expect, it } from "vitest";
import { browserBuildOf } from "../src/browser-build.js";

describe("browserBuildOf", () => {
  it("names the browser and the version it reports", () => {
    expect(browserBuildOf({ browser: { version: () => "140.0.7339.16" } })).toBe(
      "Chromium 140.0.7339.16",
    );
  });
  it("returns nothing when the session has no browser or no version", () => {
    expect(browserBuildOf({})).toBeUndefined();
    expect(browserBuildOf({ browser: {} })).toBeUndefined();
    expect(browserBuildOf({ browser: { version: () => "" } })).toBeUndefined();
  });
  it("returns nothing when the browser throws", () => {
    const browser = {
      version: () => {
        throw new Error("closed");
      },
    };
    expect(browserBuildOf({ browser })).toBeUndefined();
  });
});
