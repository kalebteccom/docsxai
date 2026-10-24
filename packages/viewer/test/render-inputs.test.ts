import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViewer } from "../src/render.js";

let tmp = "";
const docs = () => path.join(tmp, "docs");
const out = () => path.join(tmp, "out");

async function flow(name: string, steps: string[], shots: Record<string, string> = {}) {
  const dir = path.join(docs(), name);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "annotations.json"),
    JSON.stringify({ annotations: steps.map((step) => ({ step, copy: `copy ${step}` })) }),
  );
  for (const [file, body] of Object.entries(shots)) {
    await fs.writeFile(path.join(dir, "screenshots", file), body);
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-render-inputs-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("buildViewer with unusual inputs", () => {
  it("lists a flow once when --flow names it twice", async () => {
    await flow("a", ["s"], { "s.png": "x" });
    const r = await buildViewer({ docsDir: docs(), outDir: out(), flows: ["a", "a"] });
    expect(r.pages).toEqual(["index.html", "a/index.html"]);
    const index = await fs.readFile(path.join(out(), "index.html"), "utf8");
    expect(index.match(/class="flow-card"/g)).toHaveLength(1);
  });

  it("treats a directory named like a screenshot as a missing screenshot", async () => {
    await flow("a", ["s"]);
    await fs.mkdir(path.join(docs(), "a", "screenshots", "s.png"));
    const r = await buildViewer({ docsDir: docs(), outDir: out() });
    expect(r.pages).toContain("a/index.html");
    const html = await fs.readFile(path.join(out(), "a", "index.html"), "utf8");
    expect(html).toContain("shot-missing");
  });

  it("warns and skips a requested flow that has no folder under docs", async () => {
    await flow("a", ["s"], { "s.png": "x" });
    const r = await buildViewer({ docsDir: docs(), outDir: out(), flows: ["a", "typo"] });
    expect(r.pages).toEqual(["index.html", "a/index.html"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('"typo"');
  });

  it("still renders a requested flow that exists but holds no annotations or screenshots", async () => {
    await fs.mkdir(path.join(docs(), "empty"), { recursive: true });
    const r = await buildViewer({ docsDir: docs(), outDir: out(), flows: ["empty"] });
    expect(r.pages).toEqual(["index.html", "empty/index.html"]);
    expect(r.warnings).toEqual([]);
  });

  it("warns once when --lang names a language with no text table, and still renders", async () => {
    await flow("a", ["s"], { "s.png": "x" });
    const r = await buildViewer({ docsDir: docs(), outDir: out(), lang: "fr" });
    expect(r.pages).toEqual(["index.html", "a/index.html"]);
    expect(r.warnings).toEqual([
      'lang "fr" has no text table (en and es only), so the pages use English',
    ]);
    const quiet = await buildViewer({ docsDir: docs(), outDir: out(), lang: "es-ES" });
    expect(quiet.warnings).toEqual([]);
  });

  it("warns, and still writes the empty index, when the docs folder does not exist", async () => {
    const r = await buildViewer({ docsDir: path.join(tmp, "dcos"), outDir: out() });
    expect(r.pages).toEqual(["index.html"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("dcos");
  });

  it("does not warn about a docs folder that exists and is empty", async () => {
    await fs.mkdir(docs(), { recursive: true });
    const r = await buildViewer({ docsDir: docs(), outDir: out() });
    expect(r.warnings).toEqual([]);
  });

  it("serves a step id with non-ASCII and right-to-left letters", async () => {
    await flow("a", ["paso-ñ", "שלום"], { "paso-ñ.png": "x", "שלום.png": "x" });
    const r = await buildViewer({ docsDir: docs(), outDir: out() });
    expect(r.warnings).toEqual([]);
    const html = await fs.readFile(path.join(out(), "a", "index.html"), "utf8");
    expect(html).toContain('<h2 id="step-2-title">שלום</h2>');
    await expect(
      fs.access(path.join(out(), "a", "screenshots", "שלום.png")),
    ).resolves.toBeUndefined();
  });
});
