// The determinism comparator: identical files pass, and every kind of difference is reported by path
// with a cause an author can act on (JSON key path, PNG pixel region, text line, sizes). Pure file
// and buffer work, so a unit suite with no browser.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareArtefactBytes,
  compareRunRoots,
  compareRuns,
  firstJsonDifference,
} from "../src/verify-compare.js";
import { copyTree, listTree, removeListedTree } from "../src/verify-tree.js";

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

function withRect(
  base: Buffer,
  rect: { x: number; y: number; width: number; height: number },
  rgba: [number, number, number, number],
): Buffer {
  const png = PNG.sync.read(base);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [200, 0, 0, 255];
const buf = (s: string) => Buffer.from(s, "utf8");
const json = (v: unknown) => buf(JSON.stringify(v, null, 2) + "\n");

describe("firstJsonDifference", () => {
  it("returns null for equal documents", () => {
    expect(firstJsonDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBeNull();
  });

  it("names the nested key path", () => {
    expect(
      firstJsonDifference(
        { annotations: [{ bounding_box: { x: 1, y: 2 } }] },
        { annotations: [{ bounding_box: { x: 1, y: 3 } }] },
      ),
    ).toEqual({ path: "annotations[0].bounding_box.y", a: 2, b: 3 });
  });

  it("walks object keys in ordinal order, whatever order they were written in", () => {
    const a = { z: 1, a: 1 };
    const b = { a: 2, z: 2 };
    expect(firstJsonDifference(a, b)?.path).toBe("a");
  });

  it("reports an absent key and a longer array", () => {
    expect(firstJsonDifference({ a: 1 }, { a: 1, extra: true })).toEqual({
      path: "extra",
      a: undefined,
      b: true,
    });
    expect(firstJsonDifference({ items: [1, 2] }, { items: [1, 2, 3] })?.path).toBe("items[2]");
  });

  it("reports a type change and a root-level difference", () => {
    expect(firstJsonDifference({ a: 1 }, { a: "1" })?.path).toBe("a");
    expect(firstJsonDifference(1, 2)?.path).toBe("(root)");
  });
});

describe("compareArtefactBytes", () => {
  it("passes identical bytes of every kind", () => {
    const png = solidPng(4, 4, WHITE);
    expect(compareArtefactBytes("a.png", png, Buffer.from(png))).toBeNull();
    expect(compareArtefactBytes("a.json", buf("{}"), buf("{}"))).toBeNull();
    expect(compareArtefactBytes("a.md", buf("x"), buf("x"))).toBeNull();
    expect(compareArtefactBytes("a.bin", buf("x"), buf("x"))).toBeNull();
  });

  it("reports a size difference for files it has no better lens for", () => {
    const d = compareArtefactBytes("blob.bin", buf("abc"), buf("abcd"))!;
    expect(d.kind).toBe("bytes");
    expect(d.hint).toBe("size differs (3 vs 4 bytes)");
    expect(d.size).toEqual({ a: 3, b: 4 });
  });

  it("reports the first differing byte when the sizes match", () => {
    const d = compareArtefactBytes("blob.bin", buf("abc"), buf("aXc"))!;
    expect(d.hint).toBe("same size (3 bytes), first differing byte at offset 1");
  });

  it("reports the JSON key path of a difference", () => {
    const d = compareArtefactBytes(
      "docs/f/annotations.json",
      json({ annotations: [{ copy: "Open it", bounding_box: { x: 10 } }] }),
      json({ annotations: [{ copy: "Open it", bounding_box: { x: 12 } }] }),
    )!;
    expect(d.kind).toBe("json");
    expect(d.json_path).toBe("annotations[0].bounding_box.x");
    expect(d.hint).toBe("key annotations[0].bounding_box.x differs: 10 vs 12");
  });

  it("says so when the JSON data is equal and only the bytes differ", () => {
    const d = compareArtefactBytes("a.json", buf('{"a":1,"b":2}'), buf('{"b":2,"a":1}'))!;
    expect(d.kind).toBe("json");
    expect(d.json_path).toBeUndefined();
    expect(d.hint).toMatch(/^same JSON data, bytes differ/);
  });

  it("truncates long values in a JSON hint", () => {
    const d = compareArtefactBytes("a.json", json({ k: "a".repeat(200) }), json({ k: "b" }))!;
    expect(d.hint.length).toBeLessThan(120);
    expect(d.hint).toContain("…");
  });

  it("falls back to bytes for JSON that does not parse", () => {
    const d = compareArtefactBytes("a.json", buf("{not json"), buf("{not json!"))!;
    expect(d.kind).toBe("bytes");
  });

  it("reports the bounding box of the changed pixels of a PNG", () => {
    const a = solidPng(10, 10, WHITE);
    const b = withRect(a, { x: 2, y: 3, width: 4, height: 2 }, RED);
    const d = compareArtefactBytes("docs/f/screenshots/s.png", a, b)!;
    expect(d.kind).toBe("png");
    expect(d.region).toEqual({ x: 2, y: 3, width: 4, height: 2 });
    expect(d.changed_pixel_count).toBe(8);
    expect(d.hint).toBe("8 pixels differ (8%) inside x=2 y=3 4x2");
  });

  it("reports a dimension change of a PNG", () => {
    const d = compareArtefactBytes("s.png", solidPng(10, 10, WHITE), solidPng(10, 12, WHITE))!;
    expect(d.kind).toBe("png");
    expect(d.dimension_change).toEqual({
      a: { width: 10, height: 10 },
      b: { width: 10, height: 12 },
    });
    expect(d.hint).toBe("image size differs (10x10 vs 10x12 px)");
  });

  it("says so when the pixels are identical and only the PNG bytes differ", () => {
    const png = new PNG({ width: 16, height: 16 });
    png.data.fill(255);
    const a = PNG.sync.write(png, { deflateLevel: 0 });
    const b = PNG.sync.write(png, { deflateLevel: 9 });
    expect(a.equals(b)).toBe(false);
    const d = compareArtefactBytes("s.png", a, b)!;
    expect(d.kind).toBe("png");
    expect(d.region).toBeUndefined();
    expect(d.hint).toMatch(/^pixels identical, file bytes differ/);
  });

  it("falls back to bytes for a .png that does not decode", () => {
    const d = compareArtefactBytes("s.png", buf("not a png"), buf("not a png either"))!;
    expect(d.kind).toBe("bytes");
  });

  it("reports the first differing line of a text artefact", () => {
    const d = compareArtefactBytes(
      "docs/f/open.md",
      buf("# Open\n\nClick Play.\n"),
      buf("# Open\n\nClick Stop.\n"),
    )!;
    expect(d.kind).toBe("text");
    expect(d.line).toBe(3);
    expect(d.hint).toBe('line 3 differs: "Click Play." vs "Click Stop."');
  });
});

describe("tree comparison", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-verify-compare-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function put(root: string, files: Record<string, Buffer | string>): Promise<string> {
    const abs = path.join(tmp, root);
    for (const [rel, data] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(abs, rel)), { recursive: true });
      await fs.writeFile(path.join(abs, rel), data);
    }
    return abs;
  }

  it("lists files and directories in ordinal order", async () => {
    const root = await put("r", { "docs/a.md": "x", "docs/Z.md": "x", "docs/b/z.json": "{}" });
    const listing = await listTree(root);
    expect(listing.files).toEqual(["docs/Z.md", "docs/a.md", "docs/b/z.json"]);
    expect(listing.dirs).toEqual(["docs", "docs/b"]);
  });

  it("lists nothing for a root that does not exist", async () => {
    expect(await listTree(path.join(tmp, "absent"))).toEqual({ files: [], dirs: [] });
  });

  it("finds nothing between identical roots", async () => {
    const files = {
      "docs/f/annotations.json": "{}\n",
      "docs/f/screenshots/s.png": solidPng(2, 2, WHITE),
    };
    const a = await put("a", files);
    const b = await put("b", files);
    expect(await compareRunRoots(a, b, 2)).toEqual({ compared: 2, differences: [] });
  });

  it("reports missing and extra files with the run that disagreed", async () => {
    const a = await put("a", { "docs/f/a.md": "x", "docs/f/gone.md": "x" });
    const b = await put("b", { "docs/f/a.md": "x", "docs/f/new.md": "x" });
    const { differences } = await compareRunRoots(a, b, 3);
    expect(differences).toEqual([
      {
        path: "docs/f/gone.md",
        run: 3,
        kind: "missing",
        hint: "present in run 1, absent in run 3",
      },
      { path: "docs/f/new.md", run: 3, kind: "extra", hint: "absent in run 1, present in run 3" },
    ]);
  });

  it("orders differences by path whatever order the files were written in", async () => {
    const a = await put("a", { "docs/z/x.md": "1", "docs/a/x.md": "1", "docs/m/x.md": "1" });
    const b = await put("b", { "docs/m/x.md": "2", "docs/z/x.md": "2", "docs/a/x.md": "2" });
    const { differences } = await compareRunRoots(a, b, 2);
    expect(differences.map((d) => d.path)).toEqual(["docs/a/x.md", "docs/m/x.md", "docs/z/x.md"]);
  });

  it("compares run 1 against every other run, ordered by path and then run", async () => {
    const r1 = await put("r1", { "docs/a.md": "1", "docs/b.md": "1" });
    const r2 = await put("r2", { "docs/a.md": "1", "docs/b.md": "2" });
    const r3 = await put("r3", { "docs/a.md": "3", "docs/b.md": "3" });
    const { compared, differences } = await compareRuns([r1, r2, r3]);
    expect(compared).toBe(2);
    expect(differences.map((d) => [d.path, d.run])).toEqual([
      ["docs/a.md", 3],
      ["docs/b.md", 2],
      ["docs/b.md", 3],
    ]);
  });

  it("is stable: comparing the same roots twice gives the same differences", async () => {
    const a = await put("a", { "docs/x.json": '{"k":1}', "docs/y.md": "a" });
    const b = await put("b", { "docs/x.json": '{"k":2}', "docs/y.md": "b" });
    expect(await compareRuns([a, b])).toEqual(await compareRuns([a, b]));
  });

  it("copyTree copies every file to the same relative path", async () => {
    const from = await put("from", {
      "docs/f/a.json": '{"a":1}',
      "docs/f/screenshots/s.png": "png",
    });
    const to = path.join(tmp, "to");
    await fs.mkdir(to);
    expect(await copyTree(from, to)).toEqual(["docs/f/a.json", "docs/f/screenshots/s.png"]);
    expect(await fs.readFile(path.join(to, "docs/f/a.json"), "utf8")).toBe('{"a":1}');
    expect(await fs.readFile(path.join(to, "docs/f/screenshots/s.png"), "utf8")).toBe("png");
  });

  it("removeListedTree removes the root and everything listed under it", async () => {
    const root = await put("r", {
      "docs/f/a.json": "{}",
      "docs/f/screenshots/s.png": "x",
      "top.txt": "x",
    });
    await removeListedTree(root);
    await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it("removeListedTree on a root that does not exist is a no-op", async () => {
    await expect(removeListedTree(path.join(tmp, "absent"))).resolves.toBeUndefined();
  });

  it("removeListedTree unlinks a symlink and never follows it", async () => {
    const outside = await put("outside", { "keep.txt": "keep" });
    const root = await put("r", { "a.txt": "x" });
    await fs.symlink(outside, path.join(root, "link"));
    await removeListedTree(root);
    await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
});
