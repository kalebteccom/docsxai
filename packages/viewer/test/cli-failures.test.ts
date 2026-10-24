// A viewer command that cannot read or write says why: a missing input directory is reported
// before anything is written (it used to exit 0 with an empty output), and a write the disk
// refuses names the path and the chmod. Real directories, no stubs.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewerCli } from "../src/index.js";

const SAMPLE_WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/ci/sample-repo/docs-workspace",
);
const skipPerms = process.platform === "win32" || process.getuid?.() === 0;

let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-fail-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "ws");
  await fs.cp(SAMPLE_WORKSPACE, ws, { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.chmod(path.join(tmp, "ro"), 0o755).catch(() => undefined);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("missing inputs", () => {
  it("build over a docs directory that does not exist says so and still exits 0", async () => {
    const docs = path.join(tmp, "nowhere", "docs");
    expect(await runViewerCli(["build", docs, path.join(tmp, "out")])).toBe(0);
    expect(err).toContain(`viewer: warning: no docs directory at ${docs}, so the index is empty`);
    expect(err).toContain("next: docsxai run <workspace-dir>, or fix the path");
  });

  it("site names a workspace that does not exist and writes nothing", async () => {
    const missing = path.join(tmp, "nowhere");
    expect(await runViewerCli(["site", missing, "--out", path.join(tmp, "site")])).toBe(1);
    expect(err).toContain(`site: workspace ${missing} does not exist`);
    expect(err).toContain("next: docsxai init <workspace-dir>, or fix the path");
    await expect(fs.access(path.join(tmp, "site"))).rejects.toThrow();
  });

  it("site names a workspace without docs/", async () => {
    const bare = path.join(tmp, "bare");
    await fs.mkdir(bare);
    expect(await runViewerCli(["site", bare, "--out", path.join(tmp, "site")])).toBe(1);
    expect(err).toContain(`site: docs directory ${path.join(bare, "docs")} does not exist`);
    expect(err).toContain("next: docsxai run <workspace-dir>, or fix the path");
  });

  it("burn with no flows to burn ends with the run command", async () => {
    const empty = path.join(tmp, "empty");
    await fs.mkdir(path.join(empty, "docs"), { recursive: true });
    expect(await runViewerCli(["burn", empty])).toBe(1);
    expect(err).toContain(`burn: no flows with annotations.json under ${path.join(empty, "docs")}`);
    expect(err).toContain("next: docsxai run <workspace-dir>");
  });

  it("build over a docs directory without flows warns that the viewer is empty", async () => {
    const docs = path.join(tmp, "emptydocs");
    await fs.mkdir(docs);
    expect(await runViewerCli(["build", docs, path.join(tmp, "out")])).toBe(0);
    expect(err).toContain(`viewer: warning: no flows with annotations.json under ${docs}`);
    expect(err).toContain("next: docsxai run <workspace-dir>");
  });
});

describe.skipIf(skipPerms)("a read-only output directory", () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(tmp, "ro"));
    await fs.chmod(path.join(tmp, "ro"), 0o555);
  });
  const ro = () => path.join(tmp, "ro");

  it.each([
    ["build", () => ["build", path.join(ws, "docs"), path.join(ro(), "out")], "out"],
    ["site", () => ["site", ws, "--out", path.join(ro(), "site")], "site"],
    ["burn", () => ["burn", ws, "--out", path.join(ro(), "b")], "b"],
    ["pack", () => ["pack", ws, "--out", path.join(ro(), "p"), "--no-optimise"], "p"],
  ])("%s names the path and chmods the directory that denies it", async (cmd, argv, leaf) => {
    expect(await runViewerCli(argv())).toBe(1);
    expect(err).toContain(
      `${cmd}: cannot access ${path.join(ro(), leaf)} (EACCES, permission denied)`,
    );
    expect(err).toContain(`next: chmod u+rwx ${ro()}  (or pick another directory)`);
    expect(err).not.toContain("EACCES: permission denied, mkdir");
  });
});

describe("a file where a directory belongs", () => {
  it("build names the file and the move", async () => {
    const file = path.join(tmp, "out");
    await fs.writeFile(file, "x");
    expect(await runViewerCli(["build", path.join(ws, "docs"), path.join(file, "sub")])).toBe(1);
    expect(err).toContain(
      `build: ${file} is a file, but docsxai needs a directory there (ENOTDIR)`,
    );
    expect(err).toContain(`next: mv ${file} ${file}.bak, then rerun the command`);
  });
});
