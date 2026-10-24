// `--device-scale-factor` / DOCSX_DEVICE_SCALE_FACTOR: the value check, the flag-over-env order, and
// what `docsxai run` hands the runner. The runner is stubbed, so no browser starts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDeviceScaleFactor, resolveDeviceScaleFactor } from "../src/device-scale-factor.js";
import type { RunFlowsOptions } from "../src/run-flows.js";

const stub = vi.hoisted(() => ({ opts: [] as unknown[] }));
vi.mock("../src/run-flows.js", () => ({
  runFlowsInSessions: async (opts: RunFlowsOptions) => {
    stub.opts.push(opts);
    return { okCount: 1, failures: [] };
  },
}));
const { main } = await import("../src/cli.js");

describe("parseDeviceScaleFactor", () => {
  it.each(["1", "2", "3", "4", "1.5", "2.5", "4.0", "1.0"])("accepts %s", (v) => {
    expect(parseDeviceScaleFactor(v)).toBe(Number(v));
  });
  it.each(["0", "0.5", "4.1", "5", "1.25", "abc", "", "-2", "2x", "1e1", " 2", "Infinity"])(
    "rejects %j",
    (v) => {
      expect(parseDeviceScaleFactor(v)).toBeUndefined();
    },
  );
});

describe("resolveDeviceScaleFactor", () => {
  it("is unset with neither the flag nor the variable", () => {
    expect(resolveDeviceScaleFactor(undefined, {})).toEqual({ factor: undefined });
  });
  it("reads the variable when the flag is absent", () => {
    expect(resolveDeviceScaleFactor(undefined, { DOCSX_DEVICE_SCALE_FACTOR: "2" })).toEqual({
      factor: 2,
    });
  });
  it("lets the flag win over the variable", () => {
    expect(resolveDeviceScaleFactor("3", { DOCSX_DEVICE_SCALE_FACTOR: "2" })).toEqual({
      factor: 3,
    });
  });
  it("names the flag in the error for a bad flag value", () => {
    const r = resolveDeviceScaleFactor("9", {});
    expect(r).toEqual({ error: expect.stringContaining("--device-scale-factor") });
    expect((r as { error: string }).error).toContain("1 to 4");
  });
  it("names the variable in the error for a bad variable", () => {
    const r = resolveDeviceScaleFactor(undefined, { DOCSX_DEVICE_SCALE_FACTOR: "x" });
    expect((r as { error: string }).error).toContain("DOCSX_DEVICE_SCALE_FACTOR");
  });
  it("ignores the variable with --cdp, and rejects the flag", () => {
    expect(resolveDeviceScaleFactor(undefined, { DOCSX_DEVICE_SCALE_FACTOR: "2" }, true)).toEqual({
      factor: undefined,
    });
    expect(resolveDeviceScaleFactor("2", {}, true)).toEqual({
      error: expect.stringContaining("--cdp"),
    });
  });
  it("treats an empty variable as unset", () => {
    expect(resolveDeviceScaleFactor(undefined, { DOCSX_DEVICE_SCALE_FACTOR: "" })).toEqual({
      factor: undefined,
    });
  });
});

const FLOW = "name: f\nsteps:\n  - id: open\n    action: navigate\n    value: http://localhost/\n";
let ws = "";
let err = "";
const saved = process.env.DOCSX_DEVICE_SCALE_FACTOR;
beforeEach(async () => {
  stub.opts = [];
  err = "";
  delete process.env.DOCSX_DEVICE_SCALE_FACTOR;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-dsf-"));
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.writeFile(path.join(ws, "flows", "f.flow.yaml"), FLOW);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.DOCSX_DEVICE_SCALE_FACTOR;
  else process.env.DOCSX_DEVICE_SCALE_FACTOR = saved;
  await fs.rm(ws, { recursive: true, force: true });
});

const lastOpts = () => stub.opts.at(-1) as RunFlowsOptions;

describe("docsxai run --device-scale-factor", () => {
  it("passes nothing when unset", async () => {
    expect(await main(["run", ws])).toBe(0);
    expect(lastOpts().deviceScaleFactor).toBeUndefined();
  });
  it("passes the flag value", async () => {
    expect(await main(["run", ws, "--device-scale-factor", "2"])).toBe(0);
    expect(lastOpts().deviceScaleFactor).toBe(2);
  });
  it("reads the variable when the flag is absent", async () => {
    process.env.DOCSX_DEVICE_SCALE_FACTOR = "1.5";
    expect(await main(["run", ws])).toBe(0);
    expect(lastOpts().deviceScaleFactor).toBe(1.5);
  });
  it("lets the flag win over the variable", async () => {
    process.env.DOCSX_DEVICE_SCALE_FACTOR = "3";
    expect(await main(["run", ws, "--device-scale-factor", "2"])).toBe(0);
    expect(lastOpts().deviceScaleFactor).toBe(2);
  });
  it.each(["0", "5", "2.25", "two"])("exits 2 for --device-scale-factor %s", async (v) => {
    expect(await main(["run", ws, "--device-scale-factor", v])).toBe(2);
    expect(err).toContain("--device-scale-factor");
    expect(err).toContain("1 to 4");
    expect(stub.opts).toHaveLength(0);
  });
  it("exits 2 for a bare flag", async () => {
    expect(await main(["run", ws, "--device-scale-factor"])).toBe(2);
    expect(err).toContain("--device-scale-factor");
  });
  it("exits 2 for a bad variable, naming it", async () => {
    process.env.DOCSX_DEVICE_SCALE_FACTOR = "9";
    expect(await main(["run", ws])).toBe(2);
    expect(err).toContain("DOCSX_DEVICE_SCALE_FACTOR");
  });
  it("exits 2 with --cdp, which owns its own scale", async () => {
    expect(
      await main(["run", ws, "--device-scale-factor", "2", "--cdp", "http://localhost:9222"]),
    ).toBe(2);
    expect(err).toContain("--cdp");
  });
});
