import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let out = "";
let err = "";

beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("site-docs CLI — main()", () => {
  it("prints usage and exits 0 with --help / help / no args", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out).toMatch(/Usage:/);
    out = "";
    expect(await main([])).toBe(0);
    expect(out).toMatch(/site-docs run/);
    out = "";
    expect(await main(["help"])).toBe(0);
    expect(out).toMatch(/site-docs render/);
  });

  it("exits 2 on an unknown command", async () => {
    expect(await main(["frobnicate"])).toBe(2);
    expect(err).toMatch(/unknown command: frobnicate/);
  });

  it("run without a project dir exits 2", async () => {
    expect(await main(["run"])).toBe(2);
    expect(err).toMatch(/missing <project-dir>/);
  });

  it("run against a non-existent project exits 1", async () => {
    expect(await main(["run", "/definitely/not/a/real/dir"])).toBe(1);
    expect(err).toMatch(/no flows directory/);
  });

  it("render without a project dir exits 2", async () => {
    expect(await main(["render"])).toBe(2);
    expect(err).toMatch(/missing <project-dir>/);
  });

  it("capture-auth requires a project dir and --base-url, and a real auth descriptor", async () => {
    expect(await main(["capture-auth"])).toBe(2);
    expect(err).toMatch(/missing <project-dir>/);
    err = "";
    expect(await main(["capture-auth", "/some/dir"])).toBe(2);
    expect(err).toMatch(/--base-url .* required/);
    err = "";
    expect(await main(["capture-auth", "/definitely/not/real", "--base-url", "https://x"])).toBe(1);
    expect(err).toMatch(/no auth descriptor/);
  });
});
