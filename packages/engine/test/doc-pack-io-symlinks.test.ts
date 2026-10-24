// `push` serialises the workspace with readDocPack. A file there that is a symlink to somewhere
// outside the workspace is left out, so a workspace taken from a repo cannot send an arbitrary
// local file to the backend.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDocPack } from "../src/doc-pack-io.js";

let tmp = "";
let ws = "";
let outside = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-readpack-"));
  ws = path.join(tmp, "ws");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs", "f", "screenshots"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret"), "TOP-SECRET", "utf8");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const secret = () => path.join(outside, "secret");

describe("readDocPack and symlinks out of the workspace", () => {
  it("leaves out a linked flow file but keeps the real one", async () => {
    await fs.writeFile(path.join(ws, "flows", "real.flow.yaml"), "name: real\n", "utf8");
    await fs.symlink(secret(), path.join(ws, "flows", "evil.flow.yaml"));
    const pack = await readDocPack(ws);
    expect(Object.keys(pack.flows?.files ?? {})).toEqual(["real.flow.yaml"]);
  });

  it("leaves out a linked screenshot, annotations file, style and locators", async () => {
    await fs.symlink(secret(), path.join(ws, "docs", "f", "screenshots", "s.png"));
    await fs.symlink(secret(), path.join(ws, "docs", "f", "annotations.json"));
    await fs.symlink(secret(), path.join(ws, "docs", "style.yaml"));
    await fs.symlink(secret(), path.join(ws, "docs", "style.json"));
    await fs.symlink(secret(), path.join(ws, "docs", "locators.yaml"));
    const pack = await readDocPack(ws);
    expect(pack.screenshots).toBeNull();
    expect(pack.annotations).toBeNull();
    expect(pack.style).toBeNull();
    expect(pack.locators).toBeNull();
    expect(JSON.stringify(pack)).not.toContain("TOP-SECRET");
  });

  it("leaves out a flow directory that is a link to a directory outside", async () => {
    await fs.rm(path.join(ws, "docs", "f"), { recursive: true });
    await fs.mkdir(path.join(outside, "screenshots"));
    await fs.writeFile(path.join(outside, "screenshots", "s.png"), "PNG-OUTSIDE");
    await fs.writeFile(path.join(outside, "annotations.json"), '{"secret":true}');
    await fs.symlink(outside, path.join(ws, "docs", "f"));
    const pack = await readDocPack(ws);
    expect(pack.screenshots).toBeNull();
    expect(pack.annotations).toBeNull();
  });

  it("still reads files inside the workspace that are symlinks to other files inside it", async () => {
    await fs.writeFile(path.join(ws, "flows", "real.flow.yaml"), "name: real\n", "utf8");
    await fs.symlink(
      path.join(ws, "flows", "real.flow.yaml"),
      path.join(ws, "flows", "alias.flow.yaml"),
    );
    const pack = await readDocPack(ws);
    expect(Object.keys(pack.flows?.files ?? {})).toEqual(["alias.flow.yaml", "real.flow.yaml"]);
  });
});
