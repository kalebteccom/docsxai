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

  it("run --start-from without --flow exits 2 (start-from is a single-flow calibration aid)", async () => {
    expect(await main(["run", "/some/ws", "--start-from", "edit-timing"])).toBe(2);
    expect(err).toMatch(/--start-from requires --flow/);
  });

  it("render without a project dir exits 2", async () => {
    expect(await main(["render"])).toBe(2);
    expect(err).toMatch(/missing <project-dir>/);
  });

  it("init requires a workspace dir (unless --persist tmp) and validates enums", async () => {
    expect(await main(["init"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["init", "/some/dir", "--auth", "bogus"])).toBe(2);
    expect(err).toMatch(/--auth must be/);
    err = "";
    expect(await main(["init", "/some/dir", "--capture-trigger", "telepathy"])).toBe(2);
    expect(err).toMatch(/--capture-trigger must be/);
  });

  it("calibrate requires a workspace dir + a readable --from", async () => {
    expect(await main(["calibrate"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["calibrate", "/some/ws"])).toBe(2);
    expect(err).toMatch(/--from .* required/);
    err = "";
    expect(await main(["calibrate", "/some/ws", "--from", "/no/such/flow.md"])).toBe(1);
    expect(err).toMatch(/cannot read/);
  });

  it("inspect requires a workspace dir and a URL (flag or .site-docs.json)", async () => {
    expect(await main(["inspect"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["inspect", "/some/ws-without-config"])).toBe(2);
    expect(err).toMatch(/no URL/);
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
