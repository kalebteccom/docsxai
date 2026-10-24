import { describe, expect, it } from "vitest";
import { toPosix } from "../src/posix-path.js";

describe("toPosix", () => {
  it("turns the Windows separator into a forward slash", () => {
    expect(toPosix("docs\\tour\\halts\\open.png", "\\")).toBe("docs/tour/halts/open.png");
  });

  it("leaves a path that already uses forward slashes alone", () => {
    expect(toPosix("docs/tour/halts/open.png", "/")).toBe("docs/tour/halts/open.png");
    expect(toPosix("docs/tour/open.png")).toBe("docs/tour/open.png");
  });
});
