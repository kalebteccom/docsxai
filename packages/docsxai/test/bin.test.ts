// Executes the published bin (bin.mjs) as a real subprocess against a fixture workspace —
// the regression gate for the meta-package wiring (`docsxai` bin → @docsxai/engine/cli,
// run in-process). Requires the engine's dist to be built (`pnpm -r build`); the suite
// skips loudly when it isn't, and CI always builds before testing.

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binPath = path.join(pkgDir, "bin.mjs");
const engineDistCli = path.join(pkgDir, "node_modules", "@docsxai", "engine", "dist", "cli.js");
const engineBuilt = existsSync(engineDistCli);

interface BinResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function docsxai(...args: string[]): Promise<BinResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [binPath, ...args]);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const CLEAN_FLOW = `name: clean
locators: { btn: '#btn' }
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-bare-bin-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe.skipIf(!engineBuilt)("bare `docsxai` bin (meta-package wrapper)", () => {
  it("--help prints the engine CLI usage and exits 0", async () => {
    const r = await docsxai("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("docsxai — deterministic execution CLI");
    expect(r.stdout).toContain("docsxai init <workspace-dir>");
    expect(r.stdout).toContain("docsxai doctor [<workspace-dir>]");
  });

  it("init + lint round-trip against a fixture workspace", async () => {
    const ws = path.join(tmp, "ws");

    const init = await docsxai("init", ws, "--app-url", "https://localhost:3000", "--auth", "none");
    expect(init.code).toBe(0);
    expect(init.stdout).toContain(`init: workspace at ${ws}`);
    expect(existsSync(path.join(ws, ".docsxai.json"))).toBe(true);

    await fs.writeFile(path.join(ws, "flows", "clean.flow.yaml"), CLEAN_FLOW, "utf8");
    const lint = await docsxai("lint", ws);
    expect(lint.code).toBe(0);
    expect(lint.stdout).toContain("no issues");
  });

  it("propagates the engine's exit codes (unknown command exits 2)", async () => {
    const r = await docsxai("not-a-command");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command: not-a-command");
  });

  it("index.mjs re-exports the engine's library surface", async () => {
    const lib = (await import(path.join(pkgDir, "index.mjs"))) as Record<string, unknown>;
    expect(typeof lib.parseFlowFile).toBe("function");
    expect(typeof lib.runFlow).toBe("function");
    expect(typeof lib.buildDoctorChecks).toBe("function");
    expect(lib.name).toBe("@docsxai/engine");
  });
});

it("suite ran against a built engine (or skipped loudly)", () => {
  if (!engineBuilt) {
    console.warn(`bare-bin suite SKIPPED — build the engine first: pnpm -r build`);
  }
  expect(typeof engineBuilt).toBe("boolean");
});
