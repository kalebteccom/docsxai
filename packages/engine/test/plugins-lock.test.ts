import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PluginsConfigError,
  PluginsLockError,
  type PluginsLockFile,
  readPluginsLock,
  readWorkspacePluginsConfig,
  sha256Hex,
  verifyLock,
  writePluginsLock,
} from "../src/plugins/lock.js";
import { resolvePlugins } from "../src/plugins/runtime.js";
import { cleanupWorkspaces, fixturePlugin, makeWorkspace } from "./plugins-helpers.js";

afterEach(async () => {
  await cleanupWorkspaces();
});

async function fixtureRegisterSha(fixture: string, module = "register.mjs"): Promise<string> {
  const bytes = await fs.readFile(path.join(fixturePlugin(fixture), module));
  return createHash("sha256").update(bytes).digest("hex");
}

function lockFor(plugins: PluginsLockFile["plugins"]): PluginsLockFile {
  return { schema: "docsxai/plugins-lock@1", plugins };
}

describe("plugins-lock read/write", () => {
  it("round-trips through write + read with deterministic key order", async () => {
    const ws = await makeWorkspace();
    const lock = lockFor({
      zeta: { source: "path:/z", version: "1.0.0", sha256: "ff" },
      alpha: { source: "path:/a", version: "2.0.0", sha256: "aa" },
    });
    const p = await writePluginsLock(ws, lock);
    expect(p).toBe(path.join(ws, "plugins-lock.json"));
    const text = await fs.readFile(p, "utf8");
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'));
    expect(await readPluginsLock(ws)).toEqual(lock);
  });

  it("returns null when no lock file exists", async () => {
    const ws = await makeWorkspace();
    expect(await readPluginsLock(ws)).toBeNull();
  });

  it("throws PluginsLockError on malformed JSON and on a wrong schema", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws, "plugins-lock.json"), "{not json", "utf8");
    await expect(readPluginsLock(ws)).rejects.toThrow(PluginsLockError);
    await fs.writeFile(
      path.join(ws, "plugins-lock.json"),
      JSON.stringify({ schema: "docsxai/plugins-lock@2", plugins: {} }),
      "utf8",
    );
    await expect(readPluginsLock(ws)).rejects.toThrow(/docsxai\/plugins-lock@1/);
  });
});

describe("verifyLock", () => {
  it("passes when the register-module bytes match the pinned sha256", async () => {
    const bytes = await fs.readFile(path.join(fixturePlugin("multi-kind"), "register.mjs"));
    const lock = lockFor({
      multi: { source: "path:x", version: "1.2.3", sha256: sha256Hex(bytes) },
    });
    expect(verifyLock(lock, "multi", bytes)).toBeNull();
  });

  it("reports a mismatch with a run-sync hint", async () => {
    const bytes = await fs.readFile(path.join(fixturePlugin("multi-kind"), "register.mjs"));
    const lock = lockFor({
      multi: { source: "path:x", version: "1.2.3", sha256: "0".repeat(64) },
    });
    const reason = verifyLock(lock, "multi", bytes);
    expect(reason).toMatch(/lock mismatch/);
    expect(reason).toMatch(/docsxai plugins sync/);
  });

  it("reports a plugin absent from the lock", () => {
    const reason = verifyLock(lockFor({}), "multi", new Uint8Array());
    expect(reason).toMatch(/not in plugins-lock\.json/);
  });
});

describe("resolvePlugins with a lock", () => {
  it("loads a plugin whose lock entry matches", async () => {
    const ws = await makeWorkspace();
    const lock = lockFor({
      multi: {
        source: `path:${fixturePlugin("multi-kind")}`,
        version: "1.2.3",
        sha256: await fixtureRegisterSha("multi-kind"),
      },
    });
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
      lock,
    });
    expect(registry.listPlugins()[0]!.status).toBe("loaded");
  });

  it("load-errors a plugin whose register-module bytes changed since the lock", async () => {
    const ws = await makeWorkspace();
    const lock = lockFor({
      multi: {
        source: `path:${fixturePlugin("multi-kind")}`,
        version: "1.2.3",
        sha256: "0".repeat(64),
      },
    });
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
      lock,
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/lock mismatch/);
    expect(record.statusReason).toMatch(/docsxai plugins sync/);
  });

  it("load-errors a plugin missing from an existing lock", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
      lock: lockFor({}),
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/not in plugins-lock\.json/);
  });
});

describe("readWorkspacePluginsConfig", () => {
  it("returns an empty config for a workspace without a config file", async () => {
    const ws = await makeWorkspace();
    await fs.rm(path.join(ws, ".docsxai.json"));
    expect(await readWorkspacePluginsConfig(ws)).toEqual({ sources: [], capabilities: [] });
  });

  it("parses the plugins + plugin_capabilities keys", async () => {
    const ws = await makeWorkspace({
      plugins: [{ package: "docsxai-plugin-x" }, { path: "/abs/dir" }],
      plugin_capabilities: ["egress:*.example.com"],
    });
    expect(await readWorkspacePluginsConfig(ws)).toEqual({
      sources: [{ package: "docsxai-plugin-x" }, { path: "/abs/dir" }],
      capabilities: ["egress:*.example.com"],
    });
  });

  it("throws PluginsConfigError on a malformed plugins entry", async () => {
    const ws = await makeWorkspace({ plugins: [{ package: "x", path: "y" }] });
    await expect(readWorkspacePluginsConfig(ws)).rejects.toThrow(PluginsConfigError);
  });
});
