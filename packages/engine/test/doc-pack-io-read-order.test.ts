// `readDocPack` builds payload objects from directory listings. A listing comes back in disk order,
// which differs between file systems, so the payload key order has to come from the code.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDocPack } from "../src/doc-pack-io.js";

let ws = "";
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-read-order-"));
  for (const name of ["b", "a", "c"]) {
    await fs.mkdir(path.join(ws, "docs", name, "screenshots"), { recursive: true });
    await fs.writeFile(path.join(ws, "docs", name, "annotations.json"), "{}", "utf8");
    await fs.writeFile(path.join(ws, "docs", name, "screenshots", "s2.png"), name, "utf8");
    await fs.writeFile(path.join(ws, "docs", name, "screenshots", "s1.png"), name, "utf8");
  }
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  for (const name of ["b", "a", "c"]) {
    await fs.writeFile(path.join(ws, "flows", `${name}.flow.yaml`), "x", "utf8");
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

describe("readDocPack key order", () => {
  it("does not depend on the order the file system lists entries in", async () => {
    const real = fs.readdir.bind(fs) as (...args: unknown[]) => Promise<unknown[]>;
    // A listing in descending order stands in for a disk that lists entries unsorted.
    vi.spyOn(fs, "readdir").mockImplementation((async (...args: unknown[]) =>
      [...(await real(...args))].reverse()) as never);
    const pack = await readDocPack(ws);
    expect(Object.keys(pack.flows!.files)).toEqual(["a.flow.yaml", "b.flow.yaml", "c.flow.yaml"]);
    expect(Object.keys(pack.annotations!.files)).toEqual([
      "a/annotations.json",
      "b/annotations.json",
      "c/annotations.json",
    ]);
    expect(Object.keys(pack.screenshots!.files)).toEqual([
      "a/screenshots/s1.png",
      "a/screenshots/s2.png",
      "b/screenshots/s1.png",
      "b/screenshots/s2.png",
      "c/screenshots/s1.png",
      "c/screenshots/s2.png",
    ]);
  });
});
