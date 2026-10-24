// The --concurrency worker pool: a flow that halts, fails to launch or cannot be cleaned up must
// not hang the pool or hide what the other flows did, and the failure list must not depend on
// which flow finished first.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowFile } from "../src/doc-pack.js";
import { FlowExecutionError } from "../src/flow-halt.js";

const fake = vi.hoisted(() => ({
  /** Per flow: how its run goes. Default: finishes at once. */
  plan: {},
  closed: [] as string[],
}));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: async (opts: { environment?: { locale?: string } }) => {
    const name = opts.environment?.locale ?? "";
    const plan = fake.plan[name] ?? {};
    if (plan.launch) throw plan.launch;
    return {
      driver: { name },
      browser: {
        isConnected: () => !plan.pauseWaitFails,
        on: () => {
          if (plan.pauseWaitFails) throw new Error("browser handle is gone");
        },
      },
      close: async () => {
        fake.closed.push(name);
        if (plan.closeFails) throw new Error("close refused");
      },
    };
  },
}));
vi.mock("../src/flow-runtime.js", () => ({
  runFlow: async (flow: { name: string }) => {
    const plan = fake.plan[flow.name] ?? {};
    if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
    if (plan.halt) throw plan.halt;
    return {
      steps: [],
      annotations: { schema: "docsxai/annotations@1", flow: flow.name, annotations: [] },
    };
  },
}));
const { runFlowsInSessions } = await import("../src/run-flows.js");

let ws = "";
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pool-"));
  fake.plan = {};
  fake.closed = [];
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

/** The fake launcher gets no flow name, so each flow carries its own as its locale. */
function run(
  names: string[],
  concurrency: number,
  pause = false,
  progress: (line: string) => void = () => undefined,
) {
  const flows = names.map(
    (name) =>
      ({ name, steps: [], locators: {}, environment: { locale: name } }) as unknown as FlowFile,
  );
  return Promise.race([
    runFlowsInSessions({
      projectDir: ws,
      outputRoot: ws,
      flows,
      headed: pause,
      ignoreHTTPSErrors: false,
      pause,
      obstacles: false,
      concurrency,
      progress,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pool hung")), 3000)),
  ]);
}

const halt = (step: string) => new FlowExecutionError(`step "${step}" failed`, step);

describe("--concurrency worker pool", () => {
  it("reports every flow when one halts", async () => {
    fake.plan = { b: { halt: halt("s2") } };
    const r = await run(["a", "b", "c", "d"], 2);
    expect(r.okCount).toBe(3);
    expect(r.failures).toEqual([{ flow: "b", step: "s2", message: expect.stringContaining("s2") }]);
  });

  it("lists failures by flow name whatever order the flows finished in", async () => {
    // "z" halts first, "a" last; the list reads a, m, z at any concurrency.
    fake.plan = {
      z: { halt: halt("one"), delayMs: 5 },
      m: { halt: halt("two"), delayMs: 40 },
      a: { halt: halt("three"), delayMs: 80 },
    };
    for (const n of [1, 2, 3]) {
      const r = await run(["z", "m", "a"], n);
      expect(r.failures.map((f) => f.flow)).toEqual(["a", "m", "z"]);
    }
  });

  it("keeps the other results when one browser fails to launch", async () => {
    fake.plan = { b: { launch: new Error("failed to launch") } };
    const r = await run(["a", "b", "c"], 3);
    expect(r.okCount).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ flow: "b", step: null });
  });

  it("counts a flow whose browser refused to close as done and keeps the others", async () => {
    fake.plan = { a: { closeFails: true } };
    const r = await run(["a", "b", "c"], 2);
    expect(r.okCount).toBe(3);
    expect(r.failures).toEqual([]);
    expect(fake.closed.sort()).toEqual(["a", "b", "c"]);
  });

  it("closes the session when waiting for the paused browser throws", async () => {
    fake.plan = { a: { pauseWaitFails: true } };
    const r = await run(["a"], 1, true);
    expect(r.okCount).toBe(1);
    expect(fake.closed).toEqual(["a"]);
  });

  it("records a throw that escapes a flow as that flow's failure and finishes the rest", async () => {
    const r = await run(["a", "b", "c"], 2, false, (line) => {
      if (line.includes("b — starting")) throw new Error("progress sink closed");
    });
    expect(r.okCount).toBe(2);
    expect(r.failures).toEqual([{ flow: "b", step: null, message: "progress sink closed" }]);
  });
});
