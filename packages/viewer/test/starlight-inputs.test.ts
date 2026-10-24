// Starlight emitter against damaged or hostile doc packs: it must warn and keep going, and never
// build a path from a name that is not a plain path part.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitStarlightSite } from "../src/starlight.js";

let base = "";
const ws = () => path.join(base, "ws");
const site = () => path.join(base, "site");

async function flow(
  name: string,
  annotations: unknown,
  shots: string[] = [],
  rawAnnotations?: string,
) {
  const dir = path.join(ws(), "docs", name);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "annotations.json"),
    rawAnnotations ?? JSON.stringify({ annotations }),
  );
  for (const shot of shots) await fs.writeFile(path.join(dir, "screenshots", shot), "png");
}

const ann = (step: unknown, copy: unknown = "copy") => ({ step, copy });
const emit = (config = {}) => emitStarlightSite({ workspaceDir: ws(), outDir: site(), config });
const mdx = (name: string) =>
  fs.readFile(path.join(site(), "src/content/docs/flows", `${name}.mdx`), "utf8");

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-site-inputs-"));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("a damaged annotations.json", () => {
  it("warns and falls back to the screenshots when annotations is not a list", async () => {
    await flow("f", { a: 1 }, ["s1.png"]);
    const r = await emit();
    expect(r.warnings.some((w) => w.includes("annotations.json") && w.includes('"f"'))).toBe(true);
    expect(await mdx("f")).toContain("## s1");
  });

  it("warns and falls back when the file is not JSON", async () => {
    await flow("f", undefined, ["s1.png"], "{not json");
    const r = await emit();
    expect(r.warnings.some((w) => w.includes("could not be parsed"))).toBe(true);
    expect(await mdx("f")).toContain("## s1");
  });

  it("skips a record with no usable step or copy and keeps the others", async () => {
    await flow("f", [ann(5), ann("ok"), ann("no-copy", 7), null], ["ok.png"]);
    const r = await emit();
    expect(r.warnings.some((w) => w.includes("3 annotation records were skipped"))).toBe(true);
    const page = await mdx("f");
    expect(page).toContain("## ok");
    expect(page).not.toContain("no-copy");
  });
});

describe("names that are not plain path parts", () => {
  it("leaves out a step id that climbs out of the image folder, with a warning", async () => {
    await fs.writeFile(path.join(base, "leak.png"), "png");
    await flow("f", [ann("../../../../leak"), ann("ok")], ["ok.png"]);
    const r = await emit();
    expect(r.files.filter((f) => f.includes(".."))).toEqual([]);
    await expect(fs.access(path.join(site(), "leak.png"))).rejects.toThrow();
    expect(r.warnings.some((w) => w.includes("skipped") && w.includes("leak"))).toBe(true);
    expect(await mdx("f")).toContain("## ok");
  });

  it("leaves out a flow whose name holds a colon or a backslash", async () => {
    await flow("ok", [ann("s")], ["s.png"]);
    await flow("a:b", [ann("s")], ["s.png"]);
    await flow("a\\b", [ann("s")], ["s.png"]);
    const r = await emit();
    expect(r.flows).toEqual(["ok"]);
    expect(r.files.some((f) => f.includes(":") || f.includes("\\"))).toBe(false);
    expect(r.warnings.filter((w) => w.includes("skipped"))).toHaveLength(2);
  });
});

describe("what the site is asked to include", () => {
  it("warns about a requested flow the pack lacks and emits the rest once", async () => {
    await flow("a", [ann("s")], ["s.png"]);
    const r = await emit({ flows: ["a", "typo", "a"] });
    expect(r.flows).toEqual(["a"]);
    expect(r.warnings.filter((w) => w.includes('"typo"'))).toHaveLength(1);
  });

  it("warns, and still emits an empty site, when the workspace has no docs folder", async () => {
    await fs.mkdir(ws(), { recursive: true });
    const r = await emit();
    expect(r.flows).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("docs");
  });

  it("warns when docs/style.json is not JSON", async () => {
    await flow("a", [ann("s")], ["s.png"]);
    await fs.writeFile(path.join(ws(), "docs", "style.json"), "{oops");
    const r = await emit();
    expect(r.warnings).toContain(
      "docs/style.json is not valid JSON, so its visual settings were ignored",
    );
    expect(r.accent).toBeNull();
  });

  it("treats a directory named like a screenshot as a missing screenshot", async () => {
    await flow("a", [ann("s")]);
    await fs.mkdir(path.join(ws(), "docs", "a", "screenshots", "s.png"));
    const r = await emit();
    expect(r.warnings).toContain('flow "a" step "s": no screenshot');
  });
});
