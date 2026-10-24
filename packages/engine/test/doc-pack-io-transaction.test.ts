// `pull` applies a revision to the workspace all or nothing: every file is staged next to its
// target first, then renamed into place. A failure while staging touches nothing, and a failure
// while renaming puts the files already swapped back.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFilesTransactional } from "../src/atomic-write.js";
import { writeDocPack } from "../src/doc-pack-io.js";

let ws = "";
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pull-txn-"));
  await fs.writeFile(path.join(ws, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

/** Every file under `dir`, relative, sorted. */
async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  await walk(dir);
  return out.sort();
}

const annotations = (files: Record<string, unknown>) => ({
  annotations: { schema: "docsxai/annotations-bundle@1", files },
});

describe("writeDocPack is all or nothing", () => {
  it("writes nothing when a later file cannot be staged", async () => {
    await fs.mkdir(path.join(ws, "flows"));
    await fs.writeFile(path.join(ws, "flows", "tour.flow.yaml"), "old", "utf8");
    // `docs/tour` is a file, so `docs/tour/annotations.json` has no directory to go in
    await fs.mkdir(path.join(ws, "docs"));
    await fs.writeFile(path.join(ws, "docs", "tour"), "in the way", "utf8");
    const before = await tree(ws);

    await expect(
      writeDocPack(ws, {
        flows: {
          schema: "docsxai/flows@1",
          files: { "tour.flow.yaml": "new", "b.flow.yaml": "b" },
        },
        ...annotations({ "tour/annotations.json": { a: 1 } }),
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(ws, "flows", "tour.flow.yaml"), "utf8")).toBe("old");
    expect(await tree(ws)).toEqual(before);
  });

  it("puts earlier files back when a rename fails", async () => {
    await fs.mkdir(path.join(ws, "flows"));
    await fs.writeFile(path.join(ws, "flows", "tour.flow.yaml"), "old", "utf8");
    // the target of the second file is a directory, so renaming a file over it fails
    await fs.mkdir(path.join(ws, "docs", "tour", "annotations.json"), { recursive: true });
    const before = await tree(ws);

    await expect(
      writeDocPack(ws, {
        flows: {
          schema: "docsxai/flows@1",
          files: { "tour.flow.yaml": "new", "b.flow.yaml": "b" },
        },
        ...annotations({ "tour/annotations.json": { a: 1 } }),
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(ws, "flows", "tour.flow.yaml"), "utf8")).toBe("old");
    expect(await tree(ws)).toEqual(before);
    await expect(fs.stat(path.join(ws, "flows", "b.flow.yaml"))).rejects.toThrow();
  });

  it("removes a directory it created when the write fails", async () => {
    await fs.mkdir(path.join(ws, "docs", "tour", "annotations.json"), { recursive: true });
    await expect(
      writeDocPack(ws, {
        ...annotations({
          "fresh/annotations.json": { a: 1 },
          "tour/annotations.json": { b: 2 },
        }),
      }),
    ).rejects.toThrow();
    await expect(fs.stat(path.join(ws, "docs", "fresh"))).rejects.toThrow();
  });

  it("applies every file and leaves no staging file when all goes well", async () => {
    const r = await writeDocPack(ws, {
      flows: { schema: "docsxai/flows@1", files: { "tour.flow.yaml": "name: tour\n" } },
      ...annotations({ "tour/annotations.json": { a: 1 } }),
      style: { yaml: "a: 1\n", json: { a: 1 } },
      locators: { yaml: "x: y\n" },
    });
    expect(r.filesWritten).toBe(5);
    expect(await tree(ws)).toEqual([
      ".docsxai.json",
      "docs/locators.yaml",
      "docs/style.json",
      "docs/style.yaml",
      "docs/tour/annotations.json",
      "flows/tour.flow.yaml",
    ]);
  });
});

describe("writeFilesTransactional", () => {
  it.skipIf(process.platform === "win32")(
    "replaces the file behind a symlink and keeps the link",
    async () => {
      const real = path.join(ws, "real.txt");
      const link = path.join(ws, "link.txt");
      await fs.writeFile(real, "old", "utf8");
      await fs.symlink(real, link);
      await writeFilesTransactional([{ target: link, data: "new", encoding: "utf8" }]);
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(real, "utf8")).toBe("new");
    },
  );

  it.skipIf(process.platform === "win32")("keeps the mode of a file it replaces", async () => {
    const target = path.join(ws, "a.txt");
    await fs.writeFile(target, "old", { mode: 0o600 });
    await fs.chmod(target, 0o600);
    await writeFilesTransactional([{ target, data: "new", encoding: "utf8" }]);
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
  });
});
