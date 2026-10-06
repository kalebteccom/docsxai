// `docsxai run --verify-determinism` at the CLI: flag validation and exit codes (2 usage, 1 differing
// or halted, 0 identical), the three report formats on stdout with progress kept on stderr, and the
// plain `run` path through the same flow loop (output root is the workspace, progress on stdout).
// The browser is stubbed; the same command against Chromium is keystone-verify-determinism.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunFlowsOptions, RunFlowsResult } from "../src/run-flows.js";

const stub = vi.hoisted(() => ({
  run: null as null | ((opts: RunFlowsOptions) => Promise<RunFlowsResult>),
  calls: [] as RunFlowsOptions[],
}));
vi.mock("../src/run-flows.js", () => ({
  runFlowsInSessions: (opts: RunFlowsOptions) => {
    stub.calls.push(opts);
    return stub.run!(opts);
  },
}));

const { main } = await import("../src/cli.js");
const { parseVerifyArgs } = await import("../src/cli-verify.js");

let out = "";
let err = "";

const FLOW = `name: f
steps:
  - id: open
    action: navigate
    value: index.html
`;

async function write(root: string, rel: string, data: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

const flags = (...args: string[]) => {
  const m = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      m.set(a, next);
      i++;
    } else m.set(a, true);
  }
  return m;
};

describe("parseVerifyArgs", () => {
  it("is off without --verify-determinism", () => {
    expect(parseVerifyArgs(flags("flow", "f"))).toBeNull();
  });

  it("defaults to 2 runs and the text format", () => {
    expect(parseVerifyArgs(flags("verify-determinism"))).toEqual({ runs: 2, format: "text" });
  });

  it("takes --runs from 2 to 5 and the three formats", () => {
    for (const n of [2, 3, 4, 5]) {
      expect(parseVerifyArgs(flags("verify-determinism", "runs", String(n)))).toEqual({
        runs: n,
        format: "text",
      });
    }
    for (const format of ["json", "md", "text"]) {
      expect(parseVerifyArgs(flags("verify-determinism", "format", format))).toMatchObject({
        format,
      });
    }
  });

  it.each([
    ["1", /--runs must be an integer from 2 to 5/],
    ["6", /--runs must be an integer from 2 to 5/],
    ["0", /--runs must be/],
    ["two", /--runs must be/],
    ["2.5", /--runs must be/],
    ["-3", /--runs must be/],
  ])("rejects --runs %s", (value, message) => {
    expect(parseVerifyArgs(flags("verify-determinism", "runs", value))).toMatch(message);
  });

  it("rejects --runs with no value", () => {
    expect(parseVerifyArgs(flags("verify-determinism", "runs"))).toMatch(/--runs must be/);
  });

  it("rejects an unknown --format", () => {
    expect(parseVerifyArgs(flags("verify-determinism", "format", "xml"))).toMatch(
      /--format must be json \| md \| text/,
    );
  });

  it("rejects --runs and --format without --verify-determinism", () => {
    expect(parseVerifyArgs(flags("runs", "3"))).toBe("--runs requires --verify-determinism");
    expect(parseVerifyArgs(flags("format", "md"))).toBe("--format requires --verify-determinism");
  });

  it.each(["pause", "stop-after", "start-from", "cdp"])("rejects combining it with --%s", (f) => {
    const args =
      f === "pause" ? flags("verify-determinism", f) : flags("verify-determinism", f, "x");
    expect(parseVerifyArgs(args)).toBe(`--verify-determinism cannot be combined with --${f}`);
  });

  it("rejects a value after --verify-determinism (it swallowed the next word)", () => {
    expect(parseVerifyArgs(flags("verify-determinism", "ws"))).toMatch(/takes no value/);
  });
});

describe("docsxai run --verify-determinism — CLI", () => {
  let ws = "";

  beforeEach(async () => {
    out = "";
    err = "";
    stub.run = null;
    stub.calls = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-verify-cli-"));
    await write(ws, "flows/f.flow.yaml", FLOW);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(ws, { recursive: true, force: true });
  });

  const steady = async (o: RunFlowsOptions): Promise<RunFlowsResult> => {
    await write(o.outputRoot, "docs/f/annotations.json", '{"annotations":[]}\n');
    return { okCount: 1, failures: [] };
  };
  const drifting = async (o: RunFlowsOptions): Promise<RunFlowsResult> => {
    await write(
      o.outputRoot,
      "docs/f/annotations.json",
      `{"n":${path.basename(o.outputRoot).slice(4)}}\n`,
    );
    return { okCount: 1, failures: [] };
  };

  it("usage errors exit 2 before anything runs", async () => {
    for (const args of [
      ["--runs", "3"],
      ["--verify-determinism", "--runs", "9"],
      ["--verify-determinism", "--format", "xml"],
      ["--verify-determinism", "--pause"],
      ["--verify-determinism", "--stop-after", "open"],
      ["--verify-determinism", "--start-from", "open", "--flow", "f"],
      ["--verify-determinism", "--cdp", "http://localhost:9222"],
    ]) {
      err = "";
      expect(await main(["run", ws, ...args])).toBe(2);
      expect(err).toMatch(/^run: --/);
    }
    expect(stub.calls).toHaveLength(0);
  });

  it("exits 0 and prints an IDENTICAL report when the runs agree, progress on stderr", async () => {
    stub.run = steady;
    expect(await main(["run", ws, "--verify-determinism"])).toBe(0);
    expect(out).toBe(
      [
        "verify-determinism: 2 runs of 1 flow (f), 1 artefact per run",
        "result: IDENTICAL",
        "All runs wrote identical bytes; run 1's output is now the workspace output",
        "",
      ].join("\n"),
    );
    expect(err).toContain("verify-determinism: run 2 of 2");
    expect(await fs.readFile(path.join(ws, "docs/f/annotations.json"), "utf8")).toBe(
      '{"annotations":[]}\n',
    );
    expect(stub.calls).toHaveLength(2);
  });

  it("exits 1 and names the artefact when the runs differ, in each format", async () => {
    stub.run = drifting;
    expect(await main(["run", ws, "--verify-determinism"])).toBe(1);
    expect(out).toContain("result: DIFFERING");
    expect(out).toContain("first differing artefact: docs/f/annotations.json (run 2 vs run 1)");
    expect(out).toContain("cause: key n differs: 1 vs 2");
    expect(out).toContain("The workspace output was not touched");

    out = "";
    expect(await main(["run", ws, "--verify-determinism", "--format", "md"])).toBe(1);
    expect(out).toContain("## docsxai determinism check");
    expect(out).toContain("First differing artefact: `docs/f/annotations.json` (run 2 vs run 1).");

    out = "";
    expect(await main(["run", ws, "--verify-determinism", "--format", "json"])).toBe(1);
    const report = JSON.parse(out);
    expect(report.schema).toBe("docsxai/verify-determinism@1");
    expect(report.status).toBe("differing");
    expect(report.first.json_path).toBe("n");
    expect(await fs.stat(path.join(ws, "docs")).catch(() => null)).toBeNull();
  });

  it("exits 1 when a flow halts, whatever the runs agree on", async () => {
    stub.run = async () => ({
      okCount: 0,
      failures: [{ flow: "f", step: "open", message: "boom" }],
    });
    expect(await main(["run", ws, "--verify-determinism", "--runs", "3"])).toBe(1);
    expect(out).toContain("result: HALTED");
    expect(out).toContain("run 3, f, step open: boom");
    expect(stub.calls).toHaveLength(3);
  });

  it("produces the same report bytes on every invocation", async () => {
    stub.run = drifting;
    await main(["run", ws, "--verify-determinism", "--format", "json"]);
    const first = out;
    out = "";
    await main(["run", ws, "--verify-determinism", "--format", "json"]);
    expect(out).toBe(first);
  });

  it("passes --runs, --flow and --concurrency through to the runs", async () => {
    stub.run = steady;
    await write(ws, "flows/g.flow.yaml", FLOW.replace("name: f", "name: g"));
    await main([
      "run",
      ws,
      "--verify-determinism",
      "--runs",
      "3",
      "--flow",
      "g",
      "--concurrency",
      "2",
    ]);
    expect(stub.calls).toHaveLength(3);
    for (const c of stub.calls) {
      expect(c.flows.map((f) => f.name)).toEqual(["g"]);
      expect(c.concurrency).toBe(2);
    }
  });

  it("a plain run still writes into the workspace, with progress on stdout", async () => {
    stub.run = async (o) => {
      o.progress("run: f — 1 step(s) executed, 0 annotation(s) written\n");
      return { okCount: 1, failures: [] };
    };
    expect(await main(["run", ws])).toBe(0);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.outputRoot).toBe(ws);
    expect(stub.calls[0]!.pause).toBe(false);
    expect(out).toContain("run: f — 1 step(s) executed");
  });

  it("a plain run exits 1 when a flow fails", async () => {
    stub.run = async () => ({ okCount: 0, failures: [{ flow: "f", step: null, message: "x" }] });
    expect(await main(["run", ws])).toBe(1);
  });
});
