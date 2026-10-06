// The verification orchestrator with the browser stubbed out: how the runs are laid out under
// `.docsxai-verify/`, when run 1 is promoted into the workspace, how halts are recorded, and that
// the run roots are always cleaned up. The stub writes what a real flow run writes (annotations.json
// and screenshots under the output root), so the comparator and file handling are the real ones.
// The same flow against real Chromium is the keystone-verify-determinism suite.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowFile } from "../src/doc-pack.js";
import type { FlowFailure, RunFlowsOptions, RunFlowsResult } from "../src/run-flows.js";

const stub = vi.hoisted(() => ({
  run: null as null | ((opts: RunFlowsOptions) => Promise<RunFlowsResult>),
}));
vi.mock("../src/run-flows.js", () => ({
  runFlowsInSessions: (opts: RunFlowsOptions) => stub.run!(opts),
}));

const { verifyDeterminism, VERIFY_DIR } = await import("../src/verify-determinism.js");
const { formatVerifyReportText, verifyExitCode } = await import("../src/verify-report.js");

const flow = (name: string) => ({ name, steps: [], locators: {} }) as unknown as FlowFile;
const runNumber = (opts: RunFlowsOptions) => Number(path.basename(opts.outputRoot).slice(4));

async function write(root: string, rel: string, data: string | Buffer): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

describe("verifyDeterminism", () => {
  let ws = "";
  let lines: string[] = [];
  const base = () => ({
    projectDir: ws,
    flows: [flow("f")],
    headed: false,
    ignoreHTTPSErrors: false,
    obstacles: false,
    concurrency: 1,
    runs: 2,
    progress: (l: string) => void lines.push(l),
  });

  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-verify-orch-"));
    lines = [];
    stub.run = null;
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });

  /** A stub flow run that writes the same artefacts every time. */
  const steady = async (opts: RunFlowsOptions): Promise<RunFlowsResult> => {
    await write(opts.outputRoot, "docs/f/annotations.json", '{"annotations": []}\n');
    await write(opts.outputRoot, "docs/f/screenshots/open.png", "png-bytes");
    return { okCount: 1, failures: [] };
  };

  it("promotes run 1 into the workspace when every run agrees, and removes the run roots", async () => {
    stub.run = steady;
    const report = await verifyDeterminism(base());
    expect(report).toMatchObject({
      schema: "docsxai/verify-determinism@1",
      runs: 2,
      flows: ["f"],
      status: "identical",
      artefacts_compared: 2,
      first: null,
      differences: [],
      halts: [],
      promoted: true,
    });
    expect(verifyExitCode(report)).toBe(0);
    expect(await fs.readFile(path.join(ws, "docs/f/annotations.json"), "utf8")).toBe(
      '{"annotations": []}\n',
    );
    expect(await fs.readFile(path.join(ws, "docs/f/screenshots/open.png"), "utf8")).toBe(
      "png-bytes",
    );
    expect(await exists(path.join(ws, VERIFY_DIR))).toBe(false);
    expect(lines).toEqual(["verify-determinism: run 1 of 2\n", "verify-determinism: run 2 of 2\n"]);
  });

  it("runs the flows once per requested run, each into its own root", async () => {
    const seen: string[] = [];
    stub.run = async (opts) => {
      expect(opts.pause).toBe(false);
      expect(opts.projectDir).toBe(ws);
      seen.push(path.relative(ws, opts.outputRoot));
      return steady(opts);
    };
    await verifyDeterminism({ ...base(), runs: 4 });
    expect(seen).toEqual([1, 2, 3, 4].map((k) => path.join(VERIFY_DIR, `run-${k}`)));
  });

  it("leaves the workspace untouched and names the first differing artefact when the runs differ", async () => {
    stub.run = async (opts) => {
      await write(
        opts.outputRoot,
        "docs/f/annotations.json",
        JSON.stringify({ annotations: [{ bounding_box: { x: runNumber(opts) } }] }),
      );
      await write(opts.outputRoot, "docs/f/screenshots/open.png", `png-${runNumber(opts)}`);
      return { okCount: 1, failures: [] };
    };
    const report = await verifyDeterminism(base());
    expect(report.status).toBe("differing");
    expect(report.promoted).toBe(false);
    expect(verifyExitCode(report)).toBe(1);
    // annotations.json sorts before screenshots/, and the key path says where.
    expect(report.first).toMatchObject({
      path: "docs/f/annotations.json",
      run: 2,
      kind: "json",
      json_path: "annotations[0].bounding_box.x",
    });
    expect(report.differences.map((d) => d.path)).toEqual([
      "docs/f/annotations.json",
      "docs/f/screenshots/open.png",
    ]);
    expect(formatVerifyReportText(report)).toContain(
      "first differing artefact: docs/f/annotations.json (run 2 vs run 1)",
    );
    expect(await exists(path.join(ws, "docs"))).toBe(false);
    expect(await exists(path.join(ws, VERIFY_DIR))).toBe(false);
  });

  it("with three runs, a difference in the last run alone still fails", async () => {
    stub.run = async (opts) => {
      await write(opts.outputRoot, "docs/f/annotations.json", runNumber(opts) === 3 ? "{}" : "[]");
      return { okCount: 1, failures: [] };
    };
    const report = await verifyDeterminism({ ...base(), runs: 3 });
    expect(report.status).toBe("differing");
    expect(report.first?.run).toBe(3);
    expect(report.differences).toHaveLength(1);
  });

  it("reports a flow that halts in every run as halted, with the halt context compared and nothing promoted", async () => {
    const halt: FlowFailure = {
      flow: "f",
      step: "open",
      message: "[target is disabled] step failed",
    };
    stub.run = async (opts) => {
      await write(opts.outputRoot, "docs/f/halts/open.png", "halt-shot");
      return { okCount: 0, failures: [halt] };
    };
    const report = await verifyDeterminism(base());
    expect(report.status).toBe("halted");
    expect(report.halts).toEqual([
      { run: 1, ...halt },
      { run: 2, ...halt },
    ]);
    // Same halt both times: the halt context and the halt screenshot are identical artefacts.
    expect(report.differences).toEqual([]);
    expect(report.artefacts_compared).toBe(2);
    expect(report.promoted).toBe(false);
    expect(verifyExitCode(report)).toBe(1);
    expect(await exists(path.join(ws, "docs"))).toBe(false);
  });

  it("compares the halt context by key path when the runs halt on different steps", async () => {
    stub.run = async (opts) => ({
      okCount: 0,
      failures: [{ flow: "f", step: `step-${runNumber(opts)}`, message: "boom" }],
    });
    const report = await verifyDeterminism(base());
    expect(report.status).toBe("halted");
    expect(report.first).toMatchObject({
      path: "docs/f/halts/halt-context.json",
      kind: "json",
      json_path: "step",
    });
  });

  it("clears run roots a crashed earlier verification left behind, and keeps files it does not own", async () => {
    await write(path.join(ws, VERIFY_DIR), "run-1/stale.txt", "stale");
    await write(path.join(ws, VERIFY_DIR), "run-5/nested/stale.txt", "stale");
    await write(path.join(ws, VERIFY_DIR), "keep.txt", "not ours");
    stub.run = steady;
    const report = await verifyDeterminism(base());
    expect(report.status).toBe("identical");
    expect(report.artefacts_compared).toBe(2);
    expect(await fs.readFile(path.join(ws, VERIFY_DIR, "keep.txt"), "utf8")).toBe("not ours");
    expect(await exists(path.join(ws, VERIFY_DIR, "run-1"))).toBe(false);
    expect(await exists(path.join(ws, VERIFY_DIR, "run-5"))).toBe(false);
  });

  it("removes the run roots when a run throws", async () => {
    stub.run = async (opts) => {
      await write(opts.outputRoot, "docs/f/annotations.json", "{}");
      throw new Error("browser went away");
    };
    await expect(verifyDeterminism(base())).rejects.toThrow("browser went away");
    expect(await exists(path.join(ws, VERIFY_DIR))).toBe(false);
  });

  it("writes a halt context only for the flows that failed", async () => {
    stub.run = async (opts) => {
      await write(opts.outputRoot, "docs/ok/annotations.json", "{}");
      await write(opts.outputRoot, "docs/bad/halts/s.png", "x");
      return { okCount: 1, failures: [{ flow: "bad", step: "s", message: "m" }] };
    };
    const report = await verifyDeterminism({ ...base(), flows: [flow("ok"), flow("bad")] });
    expect(report.flows).toEqual(["bad", "ok"]);
    expect(report.halts.map((h) => h.flow)).toEqual(["bad", "bad"]);
    expect(report.artefacts_compared).toBe(3);
  });
});
