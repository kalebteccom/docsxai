import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  cleanupWorkspaces,
  fixturePlugin,
  makeWorkspace,
  writeTempPlugin,
} from "./plugins-helpers.js";

let out = "";
let err = "";

beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupWorkspaces();
});

describe("docsxai plugins — argument edge", () => {
  it("plugins with no subcommand exits 2 with usage", async () => {
    expect(await main(["plugins"])).toBe(2);
    expect(out).toMatch(/docsxai plugins list/);
  });

  it("plugins --help exits 0", async () => {
    expect(await main(["plugins", "--help"])).toBe(0);
    expect(out).toMatch(/plugins sync/);
  });

  it("unknown subcommand exits 2", async () => {
    expect(await main(["plugins", "frobnicate"])).toBe(2);
    expect(err).toMatch(/unknown subcommand "frobnicate"/);
  });

  it("missing workspace dir exits 2", async () => {
    expect(await main(["plugins", "list"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
  });

  it("invalid --format exits 2", async () => {
    expect(await main(["plugins", "list", "/some/ws", "--format", "xml"])).toBe(2);
    expect(err).toMatch(/--format must be/);
  });

  it("info without a namespace exits 2", async () => {
    expect(await main(["plugins", "info", "/some/ws"])).toBe(2);
    expect(err).toMatch(/missing <namespace>/);
  });

  it("a malformed plugins key in .docsxai.json exits 1 with a clear error", async () => {
    const ws = await makeWorkspace({ plugins: [{ package: "x", path: "y" }] });
    expect(await main(["plugins", "list", ws])).toBe(1);
    expect(err).toMatch(/invalid plugin configuration/);
  });
});

describe("docsxai plugins list", () => {
  it("reports an unconfigured workspace and exits 0", async () => {
    const ws = await makeWorkspace();
    expect(await main(["plugins", "list", ws])).toBe(0);
    expect(out).toMatch(/none configured/);
  });

  it("prints a loaded plugin's status line and exits 0", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "list", ws])).toBe(0);
    expect(out).toMatch(/plugins \(1 configured, 1 loaded\):/);
    expect(out).toMatch(/multi {2}loaded {2}v1\.2\.3 {2}kalebtec/);
  });

  it("prints the disabled reason and exits 1 when a plugin is not loaded", async () => {
    const ws = await makeWorkspace({
      plugins: [{ path: fixturePlugin("multi-kind") }, { path: fixturePlugin("api-too-new") }],
    });
    expect(await main(["plugins", "list", ws])).toBe(1);
    expect(out).toMatch(/toonew {2}load-error/);
    expect(out).toMatch(/↳ plugin apiVersion "2\.0\.0" is incompatible/);
    expect(out).toMatch(/multi {2}loaded/);
  });

  it("--format json emits the machine-readable status table", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "list", ws, "--format", "json"])).toBe(0);
    const records = JSON.parse(out) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      namespace: "multi",
      status: "loaded",
      version: "1.2.3",
      trust: "kalebtec",
    });
    expect(records[0]!.artifacts).toContainEqual({ kind: "renderer", name: "multi:markdown" });
  });
});

describe("docsxai plugins info", () => {
  it("prints manifest + artifacts for a namespace", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "info", ws, "multi"])).toBe(0);
    expect(out).toMatch(/apiVersion: 1\.0\.0/);
    expect(out).toMatch(/artifacts \(5\):/);
    expect(out).toMatch(/auth-strategy {2}multi:token/);
  });

  it("--format json emits the full record", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "info", ws, "multi", "--format", "json"])).toBe(0);
    const record = JSON.parse(out) as Record<string, unknown>;
    expect(record.namespace).toBe("multi");
    expect(record.manifest).toMatchObject({ apiVersion: "1.0.0", trust: "kalebtec" });
  });

  it("exits 1 for an unknown namespace, naming the configured ones", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "info", ws, "nope"])).toBe(1);
    expect(err).toMatch(/no plugin "nope"/);
    expect(err).toMatch(/multi/);
  });
});

describe("docsxai plugins sync", () => {
  it("writes plugins-lock.json with the register module's sha256", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "sync", ws])).toBe(0);
    expect(out).toMatch(/wrote .*plugins-lock\.json \(1 plugin\(s\)\)/);
    const lock = JSON.parse(await fs.readFile(path.join(ws, "plugins-lock.json"), "utf8")) as {
      schema: string;
      plugins: Record<string, { source: string; version: string; sha256: string }>;
    };
    expect(lock.schema).toBe("docsxai/plugins-lock@1");
    const bytes = await fs.readFile(path.join(fixturePlugin("multi-kind"), "register.mjs"));
    expect(lock.plugins.multi).toEqual({
      source: `path:${fixturePlugin("multi-kind")}`,
      version: "1.2.3",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("a synced workspace passes lock verification on the next list", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "sync", ws])).toBe(0);
    out = "";
    expect(await main(["plugins", "list", ws])).toBe(0);
    expect(out).toMatch(/multi {2}loaded/);
  });

  it("a tampered register module fails closed until re-synced", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-tamper-"));
    try {
      const pluginDir = await writeTempPlugin(tmp, { namespace: "tamper" });
      const ws = await makeWorkspace({ plugins: [{ path: pluginDir }] });
      expect(await main(["plugins", "sync", ws])).toBe(0);
      await fs.appendFile(path.join(pluginDir, "register.mjs"), "// tampered\n", "utf8");
      out = "";
      expect(await main(["plugins", "list", ws])).toBe(1);
      expect(out).toMatch(/lock mismatch/);
      expect(out).toMatch(/docsxai plugins sync/);
      out = "";
      expect(await main(["plugins", "sync", ws])).toBe(0);
      out = "";
      expect(await main(["plugins", "list", ws])).toBe(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("reports unresolvable sources, still locks the rest, and exits 1", async () => {
    const ws = await makeWorkspace({
      plugins: [{ path: fixturePlugin("multi-kind") }, { package: "docsxai-plugin-not-installed" }],
    });
    expect(await main(["plugins", "sync", ws])).toBe(1);
    expect(err).toMatch(/NOT locked package:docsxai-plugin-not-installed/);
    const lock = JSON.parse(await fs.readFile(path.join(ws, "plugins-lock.json"), "utf8")) as {
      plugins: Record<string, unknown>;
    };
    expect(Object.keys(lock.plugins)).toEqual(["multi"]);
  });

  it("--format json emits lockPath, lock, and failures", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: fixturePlugin("multi-kind") }] });
    expect(await main(["plugins", "sync", ws, "--format", "json"])).toBe(0);
    const result = JSON.parse(out) as {
      lockPath: string;
      lock: { schema: string; plugins: Record<string, unknown> };
      failures: unknown[];
    };
    expect(result.lockPath).toBe(path.join(ws, "plugins-lock.json"));
    expect(result.lock.schema).toBe("docsxai/plugins-lock@1");
    expect(Object.keys(result.lock.plugins)).toEqual(["multi"]);
    expect(result.failures).toEqual([]);
  });
});
