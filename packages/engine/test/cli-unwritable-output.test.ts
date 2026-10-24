// An output directory the disk refuses: `export`, `zip`, `style` and `baseline` name the path the
// operator gave (never the temp file or staging directory the engine writes first), print the
// chmod for the directory that denies the write, and exit 1. Real read-only directories, no stubs.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const skip = process.platform === "win32" || process.getuid?.() === 0;

let err = "";
let tmp = "";
let ws = "";
let ro = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-unwritable-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "ws");
  expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1"])).toBe(0);
  ro = path.join(tmp, "ro");
  await fs.mkdir(ro);
  err = "";
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of [ro, path.join(ws, "docs"), path.join(ws, ".baseline")]) {
    await fs.chmod(d, 0o755).catch(() => undefined);
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe.skipIf(skip)("read-only output", () => {
  it.each([
    ["export adf", ["export", "adf"]],
    ["export playwright", ["export", "playwright"]],
  ])("%s --out below a read-only directory chmods that directory", async (label, cmd) => {
    await fs.chmod(ro, 0o555);
    const out = path.join(ro, "out");
    expect(await main([...cmd, ws, "--out", out])).toBe(1);
    expect(err).toContain(`${label}: cannot access ${out} (EACCES, permission denied)`);
    expect(err).toContain(`next: chmod u+rwx ${ro}  (or pick another directory)`);
  });

  it("export adf --out a read-only directory names the file, not the temp file", async () => {
    await fs.chmod(ro, 0o555);
    expect(await main(["export", "adf", ws, "--out", ro])).toBe(1);
    expect(err).toContain(`export adf: cannot access ${path.join(ro, "projection.json")}`);
    expect(err).not.toContain(".tmp");
    expect(err).toContain(`next: chmod u+rwx ${ro}`);
  });

  it("zip --out below a read-only directory chmods that directory", async () => {
    await fs.chmod(ro, 0o555);
    const out = path.join(ro, "x.zip");
    expect(await main(["zip", ws, "--out", out])).toBe(1);
    expect(err).toContain(`zip: cannot access ${out} (EACCES, permission denied)`);
    expect(err).toContain(`next: chmod u+rwx ${ro}  (or pick another directory)`);
  });

  it("style in a workspace whose docs/ is read-only is labelled style and names the file", async () => {
    await fs.chmod(path.join(ws, "docs"), 0o555);
    expect(await main(["style", ws])).toBe(1);
    expect(err).toContain(`style: cannot access ${path.join(ws, "docs", "style.yaml")}`);
    expect(err).not.toContain(".tmp");
    expect(err).not.toContain("docsxai:");
  });

  it("baseline in a read-only .baseline names it, not the staging directory", async () => {
    await fs.writeFile(path.join(ws, "flows", "f.flow.yaml"), "name: f\nsteps: []\n");
    await fs.mkdir(path.join(ws, ".baseline"));
    await fs.chmod(path.join(ws, ".baseline"), 0o555);
    expect(await main(["baseline", ws])).toBe(1);
    expect(err).toContain(`baseline: cannot access ${path.join(ws, ".baseline")} (EACCES`);
    expect(err).not.toContain(".staging");
    expect(err).toContain(`next: chmod -R u+rw ${path.join(ws, ".baseline")}`);
  });
});
