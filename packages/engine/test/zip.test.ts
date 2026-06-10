// Zip-output tests. Shell out to `unzip -l` to list contents (universal where `zip` exists);
// skip when `zip` isn't on PATH.

import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipDocPack, ZipError } from "../src/zip.js";

const zipAvailable = spawnSync("zip", ["--version"], { stdio: "ignore" }).status === 0;
const unzipAvailable = spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;

async function makeWorkspace(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-zip-"));
  await fs.mkdir(path.join(tmp, "flows"), { recursive: true });
  await fs.mkdir(path.join(tmp, "docs", "f1", "screenshots"), { recursive: true });
  await fs.mkdir(path.join(tmp, "docs", "f1", "halts"), { recursive: true });
  await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
  await fs.mkdir(path.join(tmp, ".viewer"), { recursive: true });
  await fs.mkdir(path.join(tmp, "auth"), { recursive: true });

  await fs.writeFile(
    path.join(tmp, "flows", "f1.flow.yaml"),
    "name: f1\nsteps:\n  - id: s\n    action: wait\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(tmp, "docs", "f1", "annotations.json"),
    '{"schema":"site-docs/annotations@1","flow":"f1","annotations":[]}',
    "utf8",
  );
  await fs.writeFile(path.join(tmp, "docs", "f1", "screenshots", "s.png"), "fake-png", "utf8");
  await fs.writeFile(path.join(tmp, "docs", "f1", "halts", "s.png"), "halt-debug", "utf8");
  await fs.writeFile(path.join(tmp, ".auth", "editor.json"), '{"cookie":"secret"}', "utf8");
  await fs.writeFile(path.join(tmp, ".viewer", "index.html"), "<html></html>", "utf8");
  await fs.writeFile(
    path.join(tmp, "auth", "strategy.yaml"),
    "schema: site-docs/auth-strategy@1\n",
    "utf8",
  );
  await fs.writeFile(path.join(tmp, ".site-docs.json"), '{"app_url":"https://x"}', "utf8");
  return tmp;
}

async function listEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", zipPath]);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`unzip -Z1 exited ${code}`));
      else resolve(stdout.split("\n").filter(Boolean));
    });
    child.on("error", reject);
  });
}

describe.skipIf(!zipAvailable)("zipDocPack", () => {
  let workspace = "";
  let outDir = "";
  beforeEach(async () => {
    workspace = await makeWorkspace();
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-zip-out-"));
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
    await expect(fs.access(out)).resolves.toBeUndefined();
  });

  it.skipIf(!unzipAvailable)(
    "includes flows/, docs/ (minus halts/), .site-docs.json, auth/strategy.yaml",
    async () => {
      const out = path.join(outDir, "pack.zip");
      await zipDocPack({ workspace, output: out });
      const entries = await listEntries(out);
      expect(entries).toContain("flows/f1.flow.yaml");
      expect(entries).toContain("docs/f1/annotations.json");
      expect(entries).toContain("docs/f1/screenshots/s.png");
      expect(entries).toContain(".site-docs.json");
      expect(entries).toContain("auth/strategy.yaml");
    },
  );

  it.skipIf(!unzipAvailable)("excludes .auth/ and halts/ by default", async () => {
    const out = path.join(outDir, "pack.zip");
    await zipDocPack({ workspace, output: out });
    const entries = await listEntries(out);
    expect(entries.some((e) => e.startsWith(".auth/"))).toBe(false);
    expect(entries.some((e) => e.includes("/halts/"))).toBe(false);
  });

  it.skipIf(!unzipAvailable)(
    "excludes .viewer/ by default; --include-viewer pulls it in",
    async () => {
      const out1 = path.join(outDir, "no-viewer.zip");
      await zipDocPack({ workspace, output: out1 });
      const entriesA = await listEntries(out1);
      expect(entriesA.some((e) => e.startsWith(".viewer/"))).toBe(false);

      const out2 = path.join(outDir, "with-viewer.zip");
      await zipDocPack({ workspace, output: out2, includeViewer: true });
      const entriesB = await listEntries(out2);
      expect(entriesB.some((e) => e.startsWith(".viewer/"))).toBe(true);
    },
  );

  it("throws ZipError on a non-existent workspace", async () => {
    await expect(
      zipDocPack({ workspace: "/definitely/not/real", output: path.join(outDir, "x.zip") }),
    ).rejects.toThrow(ZipError);
  });

  it("throws ZipError on a workspace with nothing to zip", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-empty-"));
    await expect(
      zipDocPack({ workspace: empty, output: path.join(outDir, "x.zip") }),
    ).rejects.toThrow(/nothing to zip/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
