// Errors of the workspace commands say what failed, why, and the command to run next. Every case
// here stops before a browser starts, so nothing is stubbed except the viewer bin for `render`.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let out = "";
let err = "";
let tmp = "";

beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-hints-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

const FLOW = `name: clean
locators: { btn: '#btn' }
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

/** A scaffolded workspace (`init`) with one flow-file. */
async function scaffold(...initArgs: string[]): Promise<string> {
  const ws = path.join(tmp, "ws");
  expect(await main(["init", ws, ...initArgs])).toBe(0);
  await fs.writeFile(path.join(ws, "flows", "clean.flow.yaml"), FLOW, "utf8");
  out = "";
  err = "";
  return ws;
}

describe("init", () => {
  it("does not repeat its own prefix when the directory is not empty", async () => {
    await fs.writeFile(path.join(tmp, "keep.txt"), "x");
    expect(await main(["init", tmp])).toBe(1);
    expect(err).toMatch(/^init: .* exists and is not empty/);
    expect(err).not.toContain("init: init:");
    expect(err).toContain("--force");
  });
});

describe("calibrate", () => {
  it("names the error code when --from cannot be read", async () => {
    expect(await main(["calibrate", tmp, "--from", path.join(tmp, "missing.md")])).toBe(1);
    expect(err).toMatch(/calibrate: cannot read .*missing\.md \(ENOENT\); check the path/);
  });

  it("ends a flow-guide problem with the command to retry", async () => {
    const guide = path.join(tmp, "guide.md");
    await fs.writeFile(guide, "no yaml fence in here\n");
    expect(await main(["calibrate", tmp, "--from", guide])).toBe(1);
    expect(err).toContain(`next: fix ${guide}, then docsxai calibrate ${tmp} --from ${guide}`);
  });
});

describe("capture-auth", () => {
  it("lists the roles the descriptor has when --role names another", async () => {
    const ws = await scaffold("--app-url", "http://127.0.0.1:1");
    expect(await main(["capture-auth", ws, "--role", "ghost"])).toBe(1);
    expect(err).toContain('capture-auth: role "ghost" not in ');
    expect(err).toContain("(roles: editor); pass --role <name>");
  });

  it("says how to get a descriptor when there is none", async () => {
    const ws = await scaffold("--app-url", "http://127.0.0.1:1", "--auth", "none");
    expect(await main(["capture-auth", ws])).toBe(1);
    expect(err).toContain("capture-auth: no auth descriptor at ");
    expect(err).toContain("next: write auth/strategy.yaml");
  });
});

describe("run", () => {
  it("names capture-auth when the configured role has no cached session", async () => {
    const ws = await scaffold("--app-url", "http://127.0.0.1:1");
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain('configures role "editor" but there is no valid cached session at ');
    expect(err).toContain(`next: docsxai capture-auth ${ws}`);
  });

  it("points a flow-file error at lint", async () => {
    const ws = await scaffold("--auth", "none");
    await fs.writeFile(path.join(ws, "flows", "bad.flow.yaml"), "name: bad\nsteps: nope\n");
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain(`next: docsxai lint ${ws}`);
  });
});

describe("lint", () => {
  it("lists the flows when --flow matches none, exit 2", async () => {
    const ws = await scaffold("--auth", "none");
    expect(await main(["lint", ws, "--flow", "nope"])).toBe(2);
    expect(err).toContain("lint: flow not found: nope (flows: clean)");
  });
});

describe("render, burn, zip, baseline, diff", () => {
  it("render warns when docs/ is missing, still exits 0, and names run", async () => {
    const ws = await scaffold("--auth", "none");
    await fs.rm(path.join(ws, "docs"), { recursive: true, force: true });
    const script = path.join(tmp, "fake-viewer.js");
    await fs.writeFile(script, "process.exit(0);\n", "utf8");
    vi.stubEnv("DOCSX_VIEWER_BIN", script);
    expect(await main(["render", ws])).toBe(0);
    expect(err).toContain("render: warning");
    expect(err).toContain(`next: docsxai run ${ws}`);
  });

  it("burn without docs/ exits 1 and names run with the workspace", async () => {
    const ws = await scaffold("--auth", "none");
    await fs.rm(path.join(ws, "docs"), { recursive: true, force: true });
    expect(await main(["burn", ws])).toBe(1);
    expect(err).toContain("has no docs/ directory");
    expect(err).toContain(`next: docsxai run ${ws}`);
  });

  it("zip of an empty directory exits 1 and names run", async () => {
    const empty = path.join(tmp, "empty");
    await fs.mkdir(empty);
    expect(await main(["zip", empty, "--out", path.join(tmp, "x.zip")])).toBe(1);
    expect(err).toContain("nothing to zip");
    expect(err).toContain(`next: docsxai run ${empty}`);
  });

  it("baseline with nothing to snapshot still exits 0 and warns", async () => {
    const empty = path.join(tmp, "empty");
    await fs.mkdir(empty);
    expect(await main(["baseline", empty])).toBe(0);
    expect(out).toContain("baseline: snapshotted 0 files to ");
    expect(err).toContain("baseline: warning");
    expect(err).toContain(`next: docsxai run ${empty}`);
  });

  it("diff without a baseline exits 2 and names baseline", async () => {
    const ws = await scaffold("--auth", "none");
    expect(await main(["diff", ws])).toBe(2);
    expect(err).toContain(`next: docsxai baseline ${ws}`);
  });
});
