import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareNatural } from "../src/natural-order.js";
import { buildViewer } from "../src/render.js";
import { emitStarlightSite } from "../src/starlight.js";

describe("compareNatural", () => {
  it("orders digit runs by value", () => {
    const ids = ["step-10", "step-2", "step-1", "step-100", "step-11"];
    expect([...ids].sort(compareNatural)).toEqual([
      "step-1",
      "step-2",
      "step-10",
      "step-11",
      "step-100",
    ]);
  });

  it("keeps plain text in code-unit order and breaks ties the same way each time", () => {
    expect(["b", "a10", "a9", "a09", "a"].sort(compareNatural)).toEqual([
      "a",
      "a09",
      "a9",
      "a10",
      "b",
    ]);
    expect(compareNatural("a", "a")).toBe(0);
    expect(compareNatural("a1b", "a1")).toBeGreaterThan(0);
  });
});

describe("steps without annotations", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-natural-"));
    const dir = path.join(tmp, "docs", "f", "screenshots");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(tmp, "docs", "f", "annotations.json"), '{"annotations":[]}');
    for (const n of [1, 2, 3, 10, 11]) await fs.writeFile(path.join(dir, `step-${n}.png`), "x");
  });
  afterEach(() => fs.rm(tmp, { recursive: true, force: true }));
  const want = ["step-1", "step-2", "step-3", "step-10", "step-11"];

  it("the viewer lists the screenshots in natural order", async () => {
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir: path.join(tmp, "out") });
    const html = await fs.readFile(path.join(tmp, "out", "f", "index.html"), "utf8");
    const ids = [...html.matchAll(/<h2 id="step-\d+-title">([^<]*)</g)].map((m) => m[1]);
    expect(ids).toEqual(want);
  });

  it("the site lists the screenshots in natural order", async () => {
    await emitStarlightSite({ workspaceDir: tmp, outDir: path.join(tmp, "site") });
    const mdx = await fs.readFile(path.join(tmp, "site", "src/content/docs/flows/f.mdx"), "utf8");
    expect([...mdx.matchAll(/^## (.*)$/gm)].map((m) => m[1]!.replace(/\\/g, ""))).toEqual(want);
  });
});
