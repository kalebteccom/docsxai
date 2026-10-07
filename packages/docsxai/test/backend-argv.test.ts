// The backend's webhook runner spawns the engine CLI. Its tests use a fake engine, so a wrong
// argv never failed there: it once passed `--workspace <dir>`, which the real CLI does not read.
// These tests build the argv through the backend's own builders and run it through the engine's
// real flag parser and bin. No browser starts: `run` against a directory with no flows/ exits
// before it launches one.

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineRenderArgv, engineRunArgv, RENDER_OUT_DIR } from "../../backend/src/engine-argv.js";
import { parseFlags } from "../../engine/src/cli-shared.js";

const exec = promisify(execFile);

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binPath = path.join(pkgDir, "bin.mjs");
const engineBuilt = existsSync(
  path.join(pkgDir, "node_modules", "@docsxai", "engine", "dist", "cli.js"),
);
const viewerBuilt = existsSync(
  path.join(pkgDir, "node_modules", "@docsxai", "viewer", "dist", "index.js"),
);

async function docsxai(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await exec(process.execPath, [binPath, ...args]);
    return { code: 0, stderr };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: err.code ?? 1, stderr: err.stderr ?? "" };
  }
}

const WORKSPACE = path.join(os.tmpdir(), "docsxai-webhook-abc123");

describe("backend engine argv through the engine's flag parser", () => {
  it("run: the workspace is the first positional and no flag is set", () => {
    const [command, ...rest] = engineRunArgv(WORKSPACE);
    expect(command).toBe("run");
    const { positionals, flags } = parseFlags(rest);
    expect(positionals[0]).toBe(WORKSPACE);
    expect(flags.size).toBe(0);
  });

  it("render: the workspace is the first positional and no flag is set", () => {
    const [command, ...rest] = engineRenderArgv(WORKSPACE);
    expect(command).toBe("render");
    const { positionals, flags } = parseFlags(rest);
    expect(positionals[0]).toBe(WORKSPACE);
    expect(flags.size).toBe(0);
  });

  it("the old `--workspace <dir>` form leaves the engine without a positional", () => {
    // What the backend sent before: parseFlags consumes the directory as a flag value, so
    // positionals[0] is undefined and cmdRun / cmdRender exit 2 with `missing <workspace-dir>`.
    const { positionals } = parseFlags(["--workspace", WORKSPACE]);
    expect(positionals[0]).toBeUndefined();
  });

  it("render writes under .viewer in the workspace", () => {
    expect(RENDER_OUT_DIR).toBe(".viewer");
  });
});

describe.skipIf(!engineBuilt)("backend engine argv through the bare bin", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-backend-argv-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("run <dir> reaches the workspace check instead of failing argument validation", async () => {
    const r = await docsxai(engineRunArgv(tmp));
    expect(r.stderr).not.toContain("missing <workspace-dir>");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("has no flows/ directory");
  });

  it("the old `run --workspace <dir>` form exits 2 with missing <workspace-dir>", async () => {
    const r = await docsxai(["run", "--workspace", tmp]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("run: missing <workspace-dir>");
  });

  it.skipIf(!viewerBuilt)("render <dir> passes argument validation", async () => {
    const r = await docsxai(engineRenderArgv(tmp));
    expect(r.stderr).not.toContain("missing <workspace-dir>");
  });
});
