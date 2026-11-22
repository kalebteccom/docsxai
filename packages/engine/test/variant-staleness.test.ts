import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { findStaleVariants, formatStaleVariants } from "../src/variant-staleness.js";

const FLOW = `name: tour
locators: { btn: '#btn' }
matrix:
  locales: [en-US, es-ES]
  color_schemes: [light, dark]
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

let ws = "";
let flowPath = "";
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-stale-"));
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  flowPath = path.join(ws, "flows", "tour.flow.yaml");
  await fs.writeFile(flowPath, FLOW, "utf8");
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

async function output(id: string, offsetSeconds: number): Promise<void> {
  const dir = path.join(ws, "docs", "tour", id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "annotations.json");
  await fs.writeFile(file, "{}", "utf8");
  const when = new Date(Date.now() + offsetSeconds * 1000);
  await fs.utimes(file, when, when);
}

const entries = () => [{ flow: parseFlowFile(FLOW), filePath: flowPath }];

describe("findStaleVariants", () => {
  it("reports older and missing variants and leaves current ones out", async () => {
    await output("en-US.light", 60);
    await output("en-US.dark", -3600);
    const [one] = await findStaleVariants(ws, entries());
    expect(one).toEqual({
      flow: "tour",
      total: 4,
      stale: ["en-US.dark"],
      missing: ["es-ES.light", "es-ES.dark"],
    });
  });

  it("reports nothing when every variant is newer than the flow file", async () => {
    for (const id of ["en-US.light", "en-US.dark", "es-ES.light", "es-ES.dark"]) {
      await output(id, 60);
    }
    expect(await findStaleVariants(ws, entries())).toEqual([]);
  });

  it("ignores a flow without a matrix", async () => {
    const plain = parseFlowFile(FLOW.replace(/matrix:\n {2}locales.*\n {2}color_schemes.*\n/, ""));
    expect(await findStaleVariants(ws, [{ flow: plain, filePath: flowPath }])).toEqual([]);
  });
});

describe("formatStaleVariants", () => {
  it("prints one reason line and one next line per flow", () => {
    const text = formatStaleVariants(
      [{ flow: "tour", total: 8, stale: ["a", "b", "c", "d", "e", "f"], missing: ["g"] }],
      "my-docs",
    );
    expect(text).toBe(
      "run: tour: 6 stale (a, b, c, d, and 2 more), 1 missing (g) of 8 variants\n" +
        "  next: docsxai run my-docs --flow tour\n",
    );
  });
  it("prints nothing when there is nothing to report", () => {
    expect(formatStaleVariants([], "my-docs")).toBe("");
  });
});
