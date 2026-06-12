import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { burnFlow } from "../src/burn.js";
import { runViewerCli } from "../src/index.js";
import { solidPng } from "./helpers/png.js";

let tmp = "";
let docsDir = "";

const ANNOTATIONS = {
  schema: "docsxai/annotations@1",
  flow: "recap-open",
  annotations: [
    {
      step: "open-sidebar",
      selector: "#play",
      bounding_box: { x: 40, y: 50, width: 60, height: 24 },
      copy: "Click Play to open the recap sidebar",
    },
    {
      step: "ghost-step",
      selector: "#gone",
      bounding_box: { x: 1, y: 2, width: 3, height: 4 },
      copy: "this step has no screenshot",
    },
  ],
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-burn-"));
  docsDir = path.join(tmp, "docs");
  const flowDir = path.join(docsDir, "recap-open");
  await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
  await fs.writeFile(path.join(flowDir, "annotations.json"), JSON.stringify(ANNOTATIONS));
  await fs.writeFile(path.join(flowDir, "screenshots", "open-sidebar.png"), solidPng(320, 200));
  await fs.writeFile(path.join(flowDir, "screenshots", "plain-step.png"), solidPng(320, 200));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("burnFlow", () => {
  it("writes the full screenshot set: annotated steps burned, plain steps copied unchanged", async () => {
    const warnings: string[] = [];
    const r = await burnFlow({ docsDir, flow: "recap-open", warn: (m) => void warnings.push(m) });
    expect(r.written).toEqual(["open-sidebar.png", "plain-step.png"]);

    const outDir = path.join(docsDir, "recap-open", "burned");
    const clean = solidPng(320, 200);
    const burned = await fs.readFile(path.join(outDir, "open-sidebar.png"));
    expect(burned.equals(clean)).toBe(false); // overlays baked in
    const copied = await fs.readFile(path.join(outDir, "plain-step.png"));
    expect(copied.equals(clean)).toBe(true); // no annotations → byte-identical copy
  });

  it("warns about annotation steps that have no screenshot", async () => {
    const warnings: string[] = [];
    await burnFlow({ docsDir, flow: "recap-open", warn: (m) => void warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ghost-step");
  });

  it("honors an explicit outDir", async () => {
    const outDir = path.join(tmp, "elsewhere");
    await burnFlow({ docsDir, flow: "recap-open", outDir });
    await expect(fs.access(path.join(outDir, "open-sidebar.png"))).resolves.toBeUndefined();
  });

  it("throws a clear error when the flow has no annotations.json", async () => {
    await fs.mkdir(path.join(docsDir, "bare-flow"), { recursive: true });
    await expect(burnFlow({ docsDir, flow: "bare-flow" })).rejects.toThrow(/annotations\.json/);
  });
});

describe("docsxai-viewer burn (CLI)", () => {
  it("burns every discovered flow into docs/<flow>/burned by default", async () => {
    const code = await runViewerCli(["burn", tmp]);
    expect(code).toBe(0);
    await expect(
      fs.access(path.join(docsDir, "recap-open", "burned", "open-sidebar.png")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(docsDir, "recap-open", "burned", "plain-step.png")),
    ).resolves.toBeUndefined();
  });

  it("honors --flow and --out", async () => {
    const out = path.join(tmp, "burn-out");
    const code = await runViewerCli(["burn", tmp, "--flow", "recap-open", "--out", out]);
    expect(code).toBe(0);
    await expect(
      fs.access(path.join(out, "recap-open", "open-sidebar.png")),
    ).resolves.toBeUndefined();
  });

  it("exits 2 without a workspace argument", async () => {
    expect(await runViewerCli(["burn"])).toBe(2);
  });

  it("exits 1 when the workspace has no flows", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-empty-"));
    expect(await runViewerCli(["burn", empty])).toBe(1);
    await fs.rm(empty, { recursive: true, force: true });
  });

  it("keeps the existing default behavior: no args prints usage and exits 0", async () => {
    expect(await runViewerCli([])).toBe(0);
    expect(await runViewerCli(["bogus"])).toBe(2);
  });
});
