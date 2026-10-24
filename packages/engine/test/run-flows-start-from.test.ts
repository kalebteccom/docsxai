// `run --start-from` merges the fresh annotations into the file already on disk by step id. A file
// that is there but unusable is replaced, and the run says the earlier steps are dropped.

import { promises as fs } from "node:fs";
import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowFile } from "../src/doc-pack.js";

vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: () =>
    Promise.resolve({
      driver: {},
      browser: Object.assign(new EventEmitter(), { isConnected: () => true }),
      close: () => Promise.resolve(),
    }),
}));
vi.mock("../src/flow-runtime.js", () => ({
  runFlow: () =>
    Promise.resolve({
      steps: [{ id: "b", action: "click" }],
      annotations: {
        schema: "docsxai/annotations@1",
        flow: "f",
        annotations: [{ step: "b", selector: "#b", copy: "new b" }],
      },
    }),
}));
const { runFlowsInSessions } = await import("../src/run-flows.js");

let ws = "";
let lines: string[] = [];
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-start-from-"));
  await fs.writeFile(path.join(ws, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
  await fs.mkdir(path.join(ws, "docs", "f"), { recursive: true });
  lines = [];
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

const annotationsFile = () => path.join(ws, "docs", "f", "annotations.json");

async function runFromB(): Promise<void> {
  const result = await runFlowsInSessions({
    projectDir: ws,
    outputRoot: ws,
    flows: [{ name: "f", steps: [], locators: {} } as unknown as FlowFile],
    startFrom: "b",
    headed: false,
    ignoreHTTPSErrors: false,
    pause: false,
    obstacles: false,
    concurrency: 1,
    progress: (l) => void lines.push(l),
  });
  expect(result.okCount).toBe(1);
}

describe("run --start-from merge", () => {
  it("keeps the earlier steps and replaces the re-run one", async () => {
    await fs.writeFile(
      annotationsFile(),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow: "f",
        annotations: [
          { step: "a", selector: "#a", copy: "a" },
          { step: "b", selector: "#b", copy: "old b" },
        ],
      }),
      "utf8",
    );
    await runFromB();
    const written = JSON.parse(await fs.readFile(annotationsFile(), "utf8"));
    expect(written.annotations.map((a: { step: string; copy: string }) => a.copy)).toEqual([
      "a",
      "new b",
    ]);
    expect(lines.join("")).not.toMatch(/warning/);
  });

  it("warns when the existing annotations.json is not valid JSON", async () => {
    await fs.writeFile(annotationsFile(), '{"annotations": [', "utf8");
    await runFromB();
    expect(lines.join("")).toMatch(/warning: .*annotations\.json cannot be read.*earlier steps/);
    const written = JSON.parse(await fs.readFile(annotationsFile(), "utf8"));
    expect(written.annotations).toHaveLength(1);
  });

  it("warns when the existing file has no annotations list", async () => {
    await fs.writeFile(annotationsFile(), '{"schema":"other"}', "utf8");
    await runFromB();
    expect(lines.join("")).toMatch(/warning: .*is not an annotations file.*earlier steps/);
  });

  it("does not warn when there is no existing file", async () => {
    await runFromB();
    expect(lines.join("")).not.toMatch(/warning/);
  });
});
