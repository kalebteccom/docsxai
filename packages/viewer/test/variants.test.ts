// A flow that ran a matrix writes docs/<flow>/<variant>/{annotations.json, screenshots/}; render and
// burn treat each `<flow>/<variant>` as a flow, and a flow without a matrix is found and linked as before.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runViewerCli } from "../src/index.js";
import { buildViewer, discoverFlows } from "../src/render.js";
import { solidPng } from "./helpers/png.js";

let tmp = "";
let docsDir = "";

async function writeFlowDir(rel: string, flow: string, variant?: unknown): Promise<void> {
  const dir = path.join(docsDir, rel);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "annotations.json"),
    JSON.stringify({
      schema: "docsxai/annotations@1",
      flow,
      ...(variant ? { variant } : {}),
      annotations: [
        {
          step: "open",
          selector: "#play",
          bounding_box: { x: 40, y: 50, width: 60, height: 24 },
          copy: "Click Play",
        },
      ],
    }),
  );
  await fs.writeFile(path.join(dir, "screenshots", "open.png"), solidPng(320, 200));
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-variants-"));
  docsDir = path.join(tmp, "docs");
  await writeFlowDir("plain-flow", "plain-flow");
  for (const id of ["en-US.dark", "es-ES.light"]) {
    await writeFlowDir(`matrix-flow/${id}`, "matrix-flow", { id });
  }
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("discoverFlows", () => {
  it("lists only top-level flows by default", async () => {
    expect(await discoverFlows(docsDir)).toEqual(["plain-flow"]);
  });

  it("lists `<flow>/<variant>` for a matrix flow when asked, sorted", async () => {
    expect(await discoverFlows(docsDir, { variants: true })).toEqual([
      "matrix-flow/en-US.dark",
      "matrix-flow/es-ES.light",
      "plain-flow",
    ]);
  });

  it("does not mistake screenshots/, halts/ or burned/ of a flat flow for variants", async () => {
    await fs.mkdir(path.join(docsDir, "plain-flow", "burned"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "plain-flow", "halts"), { recursive: true });
    expect(await discoverFlows(docsDir, { variants: true })).not.toContain("plain-flow/burned");
    expect(await discoverFlows(docsDir, { variants: true })).toHaveLength(3);
  });
});

describe("buildViewer with variants", () => {
  it("renders a page per variant with a back link that reaches the index, and keeps the flat flow's link", async () => {
    const outDir = path.join(tmp, "out");
    const r = await buildViewer({ docsDir, outDir });
    expect(r.pages).toEqual([
      "index.html",
      "matrix-flow/en-US.dark/index.html",
      "matrix-flow/es-ES.light/index.html",
      "plain-flow/index.html",
    ]);
    const variantHtml = await fs.readFile(
      path.join(outDir, "matrix-flow", "en-US.dark", "index.html"),
      "utf8",
    );
    expect(variantHtml).toContain('href="../../index.html"');
    expect(variantHtml).toContain('src="screenshots/open.png"');
    const flatHtml = await fs.readFile(path.join(outDir, "plain-flow", "index.html"), "utf8");
    expect(flatHtml).toContain('href="../index.html"');
    await expect(
      fs.access(path.join(outDir, "matrix-flow", "en-US.dark", "screenshots", "open.png")),
    ).resolves.toBeUndefined();
  });
});

describe("docsxai-viewer burn with variants", () => {
  it("burns every variant into its own burned/ directory", async () => {
    expect(await runViewerCli(["burn", tmp])).toBe(0);
    for (const id of ["en-US.dark", "es-ES.light"]) {
      await expect(
        fs.access(path.join(docsDir, "matrix-flow", id, "burned", "open.png")),
      ).resolves.toBeUndefined();
    }
    await expect(
      fs.access(path.join(docsDir, "plain-flow", "burned", "open.png")),
    ).resolves.toBeUndefined();
  });

  it("--flow <flow> selects the flow's variants, and --out keeps them apart", async () => {
    const out = path.join(tmp, "burn-out");
    expect(await runViewerCli(["burn", tmp, "--flow", "matrix-flow", "--out", out])).toBe(0);
    await expect(
      fs.access(path.join(out, "matrix-flow", "en-US.dark", "open.png")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(out, "matrix-flow", "es-ES.light", "open.png")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(out, "plain-flow", "open.png"))).rejects.toThrow();
  });

  it("--flow <flow>/<variant> still selects one variant", async () => {
    const out = path.join(tmp, "burn-one");
    expect(
      await runViewerCli(["burn", tmp, "--flow", "matrix-flow/es-ES.light", "--out", out]),
    ).toBe(0);
    await expect(
      fs.access(path.join(out, "matrix-flow", "es-ES.light", "open.png")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(out, "matrix-flow", "en-US.dark"))).rejects.toThrow();
  });
});
