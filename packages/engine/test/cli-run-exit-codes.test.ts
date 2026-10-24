// Every way a `docsxai run` can end maps to one of the documented exit codes: 0 success, 1 runtime
// failure (a halt, a browser that did not start, outputs that could not be written), 2 usage error.
// A mistake in the command line is caught before any browser launches, so it never reaches the
// runner and never reads as a halt.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVerifyReport, verifyExitCode } from "../src/verify-report.js";
import type { FlowFailure, RunFlowsOptions, RunFlowsResult } from "../src/run-flows.js";

const stub = vi.hoisted(() => ({
  calls: 0,
  result: { okCount: 1, failures: [] },
}));
vi.mock("../src/run-flows.js", () => ({
  runFlowsInSessions: async (_opts: RunFlowsOptions) => {
    stub.calls++;
    return stub.result;
  },
}));
const { main } = await import("../src/cli.js");

const FLOW =
  "name: f\nsteps:\n  - id: open\n    action: navigate\n    value: http://localhost/\n  - id: save\n    action: click\n    target: '#save'\n";

let ws = "";
let err = "";
beforeEach(async () => {
  stub.calls = 0;
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-run-exit-"));
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.writeFile(path.join(ws, "flows", "f.flow.yaml"), FLOW);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

const halted = (message: string): FlowFailure => ({ flow: "f", step: "save", message });

describe("run exit code per outcome", () => {
  it.each<[string, RunFlowsResult, number]>([
    ["every flow finished", { okCount: 1, failures: [] }, 0],
    ["a step halted", { okCount: 0, failures: [halted('step "save" (click) failed at /')] }, 1],
    [
      "a step halted with an inferred cause",
      { okCount: 0, failures: [halted("[target is disabled] step save failed")] },
      1,
    ],
    [
      "the browser did not start",
      { okCount: 0, failures: [{ flow: "f", step: null, message: "failed to launch browser" }] },
      1,
    ],
    [
      "the outputs could not be written",
      {
        okCount: 0,
        failures: [
          { flow: "f", step: null, message: "cannot write the outputs under /ws (EACCES): x" },
        ],
      },
      1,
    ],
    [
      "some flows finished and one halted",
      { okCount: 2, failures: [halted("[target is not visible] step save failed")] },
      1,
    ],
  ])("%s", async (_cause, result, code) => {
    stub.result = result;
    expect(await main(["run", ws])).toBe(code);
    expect(stub.calls).toBe(1);
  });
});

describe("run exit code for a mistake in the command line", () => {
  it.each<[string, string[], RegExp]>([
    ["--start-from names no step", ["--flow", "f", "--start-from", "svae"], /--start-from/],
    ["--stop-after names no step", ["--stop-after", "svae"], /--stop-after/],
    ["--concurrency is zero", ["--concurrency", "0"], /--concurrency/],
    ["--start-from without --flow", ["--start-from", "open"], /--flow/],
    ["an unknown flag", ["--stop-afer", "save"], /unknown flag/],
  ])("%s exits 2 before any browser starts", async (_cause, flags, message) => {
    expect(await main(["run", ws, ...flags])).toBe(2);
    expect(err).toMatch(message);
    expect(stub.calls).toBe(0);
  });

  it("names the steps the flow has when --start-from is wrong", async () => {
    expect(await main(["run", ws, "--flow", "f", "--start-from", "svae"])).toBe(2);
    expect(err).toContain('no step "svae" in flow "f" (steps: open, save)');
  });

  it("still runs when --start-from and --stop-after name real steps", async () => {
    stub.result = { okCount: 1, failures: [] };
    expect(
      await main(["run", ws, "--flow", "f", "--start-from", "open", "--stop-after", "save"]),
    ).toBe(0);
    expect(stub.calls).toBe(1);
  });
});

describe("run --verify-determinism exit code per status", () => {
  const base = {
    runs: 2,
    flows: ["f"],
    artefactsCompared: 3,
    differences: [],
    halts: [],
    promoted: false,
  };
  it.each([
    ["identical", base, 0],
    [
      "differing",
      { ...base, differences: [{ path: "docs/f/annotations.json", kind: "content" as const }] },
      1,
    ],
    ["halted", { ...base, halts: [{ run: 1, flow: "f", step: "save", message: "boom" }] }, 1],
  ])("%s", (_status, input, code) => {
    expect(verifyExitCode(buildVerifyReport(input as never))).toBe(code);
  });
});
