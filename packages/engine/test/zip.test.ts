// Zip-output tests. The packager zips in-process (fflate), so round-trips are verified with
// fflate's unzipSync — no system `zip`/`unzip` binary involved, no skip gates.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipDocPack, ZipError } from "../src/zip.js";

const FLOW_YAML = "name: f1\nsteps:\n  - id: s\n    action: wait\n";
const ANNOTATIONS_JSON = '{"schema":"docsxai/annotations@1","flow":"f1","annotations":[]}';

async function makeWorkspace(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-zip-"));
  await fs.mkdir(path.join(tmp, "flows"), { recursive: true });
  await fs.mkdir(path.join(tmp, "docs", "f1", "screenshots"), { recursive: true });
  await fs.mkdir(path.join(tmp, "docs", "f1", "halts"), { recursive: true });
  await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
  await fs.mkdir(path.join(tmp, ".viewer"), { recursive: true });
  await fs.mkdir(path.join(tmp, "auth"), { recursive: true });

  await fs.writeFile(path.join(tmp, "flows", "f1.flow.yaml"), FLOW_YAML, "utf8");
  await fs.writeFile(path.join(tmp, "docs", "f1", "annotations.json"), ANNOTATIONS_JSON, "utf8");
  await fs.writeFile(path.join(tmp, "docs", "f1", "screenshots", "s.png"), "fake-png", "utf8");
  await fs.writeFile(path.join(tmp, "docs", "f1", "halts", "s.png"), "halt-debug", "utf8");
  await fs.writeFile(path.join(tmp, ".auth", "editor.json"), '{"cookie":"secret"}', "utf8");
  await fs.writeFile(path.join(tmp, ".viewer", "index.html"), "<html></html>", "utf8");
  await fs.writeFile(
    path.join(tmp, "auth", "strategy.yaml"),
    "schema: docsxai/auth-strategy@1\n",
    "utf8",
  );
  await fs.writeFile(path.join(tmp, ".docsxai.json"), '{"app_url":"https://x"}', "utf8");
  await fs.writeFile(path.join(tmp, "README.md"), "# workspace\n", "utf8");
  return tmp;
}

async function readArchive(zipPath: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await fs.readFile(zipPath)));
}

describe("zipDocPack", () => {
  let workspace = "";
  let outDir = "";
  beforeEach(async () => {
    workspace = await makeWorkspace();
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-zip-out-"));
  });
  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("creates a non-empty zip at the requested output path", async () => {
    const out = path.join(outDir, "pack.zip");
    const r = await zipDocPack({ workspace, output: out });
    expect(r.output).toBe(out);
    expect(r.bytes).toBeGreaterThan(0);
    const stat = await fs.stat(out);
    expect(stat.size).toBe(r.bytes);
  });

  it("includes flows/, docs/ (minus halts/), .docsxai.json, auth/strategy.yaml, README.md", async () => {
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(entries).toContain("flows/f1.flow.yaml");
    expect(entries).toContain("docs/f1/annotations.json");
    expect(entries).toContain("docs/f1/screenshots/s.png");
    expect(entries).toContain(".docsxai.json");
    expect(entries).toContain("auth/strategy.yaml");
    expect(entries).toContain("README.md");
  });

  it("round-trips file contents byte-for-byte", async () => {
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const archive = await readArchive(out);
    expect(strFromU8(archive["flows/f1.flow.yaml"]!)).toBe(FLOW_YAML);
    expect(strFromU8(archive["docs/f1/annotations.json"]!)).toBe(ANNOTATIONS_JSON);
  });

  it("reports the archived entries, sorted, matching the archive's contents", async () => {
    const out = path.join(outDir, "pack.zip");
    const r = await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(r.entries).toEqual([...r.entries].sort());
    expect([...entries].sort()).toEqual(r.entries);
  });

  it("excludes .auth/ and halts/ by default", async () => {
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(entries.some((e) => e.startsWith(".auth/"))).toBe(false);
    expect(entries.some((e) => e.includes("halts/"))).toBe(false);
  });

  it("excludes .viewer/ by default; --include-viewer pulls it in", async () => {
    const out1 = path.join(outDir, "no-viewer.zip");
    await zipDocPack({ workspace, output: out1 });
    const entriesA = Object.keys(await readArchive(out1));
    expect(entriesA.some((e) => e.startsWith(".viewer/"))).toBe(false);

    const out2 = path.join(outDir, "with-viewer.zip");
    await zipDocPack({ workspace, output: out2, includeViewer: true });
    const entriesB = Object.keys(await readArchive(out2));
    expect(entriesB).toContain(".viewer/index.html");
  });

  it("excludes .DS_Store and *.tmp files", async () => {
    await fs.writeFile(path.join(workspace, "docs", ".DS_Store"), "junk", "utf8");
    await fs.writeFile(path.join(workspace, "docs", "f1", "scratch.tmp"), "junk", "utf8");
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(entries.some((e) => e.endsWith(".DS_Store"))).toBe(false);
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });

  it("does not follow a symlink that escapes the workspace", async () => {
    const secret = path.join(outDir, "outside-secret.txt");
    await fs.writeFile(secret, "exfil-me", "utf8");
    await fs.symlink(secret, path.join(workspace, "docs", "f1", "link.txt"));
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(entries.some((e) => e.endsWith("link.txt"))).toBe(false);
  });

  it("is deterministic — two zips of the same tree are byte-identical, mtime pinned", async () => {
    const out1 = path.join(outDir, "a.zip");
    const out2 = path.join(outDir, "b.zip");
    await zipDocPack({ workspace, output: out1 });
    await zipDocPack({ workspace, output: out2 });
    const a = await fs.readFile(out1);
    const b = await fs.readFile(out2);
    expect(a.equals(b)).toBe(true);
    // First local file header: DOS mod-time at offset 10, mod-date at offset 12 — pinned to
    // 1980-01-01 00:00 (the zip epoch), not the wall clock.
    expect(a.readUInt16LE(10)).toBe(0);
    expect(a.readUInt16LE(12)).toBe(0x21);
  });

  it("overwrites a pre-existing output file instead of appending", async () => {
    const out = path.join(outDir, "pack.zip");
    await fs.writeFile(out, "stale-not-a-zip", "utf8");
    const r = await zipDocPack({ workspace, output: out });
    const entries = Object.keys(await readArchive(out));
    expect(entries).toContain("flows/f1.flow.yaml");
    expect((await fs.stat(out)).size).toBe(r.bytes);
  });

  it("throws ZipError on a non-existent workspace", async () => {
    await expect(
      zipDocPack({ workspace: "/definitely/not/real", output: path.join(outDir, "x.zip") }),
    ).rejects.toThrow(ZipError);
  });

  it("throws ZipError on a workspace with nothing to zip", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-empty-"));
    await expect(
      zipDocPack({ workspace: empty, output: path.join(outDir, "x.zip") }),
    ).rejects.toThrow(/nothing to zip/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
