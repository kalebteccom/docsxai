// The top-level entries `zip` always includes (flows/, docs/, .docsxai.json, auth/strategy.yaml,
// README.md) get the same symlink check as what is found below them, and a zip that fails for
// lack of content leaves no output directory behind.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipDocPack, ZipError } from "../src/zip.js";

let tmp = "";
let workspace = "";
let outside = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-zip-includes-"));
  workspace = path.join(tmp, "ws");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(workspace, "flows"), { recursive: true });
  await fs.writeFile(path.join(workspace, "flows", "f.flow.yaml"), "name: f\n", "utf8");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "TOP-SECRET", "utf8");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const archiveText = async (out: string): Promise<string> => {
  const files = unzipSync(new Uint8Array(await fs.readFile(out)));
  return Object.entries(files)
    .map(([name, data]) => `${name}\n${strFromU8(data)}`)
    .join("\n");
};

describe("zip includes", () => {
  it("skips README.md when it is a symlink out of the workspace", async () => {
    await fs.symlink(path.join(outside, "secret.txt"), path.join(workspace, "README.md"));
    const out = path.join(tmp, "out.zip");
    const r = await zipDocPack({ workspace, output: out });
    expect(r.entries).toEqual(["flows/f.flow.yaml"]);
    expect(await archiveText(out)).not.toContain("TOP-SECRET");
  });

  it("skips docs/ when it is a symlink to a directory outside the workspace", async () => {
    await fs.symlink(outside, path.join(workspace, "docs"));
    const out = path.join(tmp, "out.zip");
    const r = await zipDocPack({ workspace, output: out });
    expect(r.entries).toEqual(["flows/f.flow.yaml"]);
    expect(await archiveText(out)).not.toContain("TOP-SECRET");
  });

  it("creates no output directory when there is nothing to zip", async () => {
    await fs.rm(path.join(workspace, "flows"), { recursive: true });
    const out = path.join(tmp, "new-dir", "out.zip");
    await expect(zipDocPack({ workspace, output: out })).rejects.toThrow(ZipError);
    await expect(fs.access(path.join(tmp, "new-dir"))).rejects.toThrow();
  });
});
