import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginRegistryError } from "../src/plugins/registry.js";
import { resolvePlugins } from "../src/plugins/runtime.js";
import type { PluginLogger, PublisherContext } from "../src/plugins/types.js";
import {
  cleanupWorkspaces,
  fixturePlugin,
  makeWorkspace,
  PLUGIN_FIXTURES_DIR,
} from "./plugins-helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupWorkspaces();
});

const SILENT_LOG: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

function publisherCtx(workspaceDir: string): PublisherContext {
  return {
    workspaceDir,
    projection: null,
    artifactsDir: path.join(workspaceDir, "docs"),
    config: {},
    secretsEnv: {},
    log: SILENT_LOG,
  };
}

describe("resolvePlugins — well-formed plugin", () => {
  it("loads a multi-kind plugin with an exact status record", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    const records = registry.listPlugins();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: "docsxai-plugin-multi-kind-fixture",
      version: "1.2.3",
      namespace: "multi",
      source: `path:${fixturePlugin("multi-kind")}`,
      trust: "kalebtec",
      status: "loaded",
    });
    expect(records[0]!.statusReason).toBeUndefined();
  });

  it("auto-prefixes every registered artifact with the namespace", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    expect(registry.listPlugins()[0]!.artifacts).toEqual([
      { kind: "publisher", name: "multi:wiki" },
      { kind: "publisher", name: "multi:escape-probe" },
      { kind: "renderer", name: "multi:markdown" },
      { kind: "lint-rules", name: "multi:extra" },
      { kind: "auth-strategy", name: "multi:token" },
    ]);
  });

  it("retrieves publisher/renderer/auth-strategies/lint-rules through the registry", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    const publish = await registry.getPublisher("multi:wiki").publish(publisherCtx(ws));
    expect(publish.ok).toBe(true);
    expect(publish.pages).toEqual([{ id: "p1", url: "http://127.0.0.1:9/p1", action: "created" }]);
    const render = await registry
      .getRenderer("multi:markdown")
      .render({ workspaceDir: ws, outDir: "/tmp/out", flows: [], config: {}, log: SILENT_LOG });
    expect(render.outputs).toEqual(["/tmp/out/out.md"]);
    expect([...registry.getAuthStrategies().keys()]).toEqual(["multi:token"]);
    expect(registry.getLintRules().map((r) => r.code)).toEqual(["X100", "X101"]);
  });

  it("pluginsInfo answers by namespace and by package name", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    expect(registry.pluginsInfo("multi")?.name).toBe("docsxai-plugin-multi-kind-fixture");
    expect(registry.pluginsInfo("docsxai-plugin-multi-kind-fixture")?.namespace).toBe("multi");
    expect(registry.pluginsInfo("nope")).toBeUndefined();
  });

  it("prefixes plugin log output with [plugin:<ns>] on stderr", async () => {
    let captured = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      captured += String(chunk);
      return true;
    });
    const ws = await makeWorkspace();
    await resolvePlugins({ workspaceDir: ws, sources: [{ path: fixturePlugin("multi-kind") }] });
    expect(captured).toContain("[plugin:multi] registering fixture artifacts");
  });

  it("throws a clear PluginRegistryError for an unknown artifact name", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    expect(() => registry.getPublisher("multi:nope")).toThrow(PluginRegistryError);
    expect(() => registry.getPublisher("multi:nope")).toThrow(/multi:wiki/);
    expect(() => registry.getRenderer("other:thing")).toThrow(/no renderer named/);
  });
});

describe("resolvePlugins — workspace containment", () => {
  it("api.workspacePath resolves inside the workspace the registry was built for", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    const result = await registry.getPublisher("multi:wiki").publish(publisherCtx(ws));
    expect(result.target).toBe(path.join(ws, "docs", "published"));
  });

  it("rejects a workspacePath escape attempt at call time", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }],
    });
    await expect(
      registry.getPublisher("multi:escape-probe").publish(publisherCtx(ws)),
    ).rejects.toThrow(/escapes workspace root/);
  });

  it("a workspacePath escape during register() load-errors the plugin", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("ws-escape") }],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/docsxai-plugin-ws-escape-fixture/);
    expect(record.statusReason).toMatch(/escapes workspace root/);
  });
});

describe("resolvePlugins — rejection statuses", () => {
  it("load-errors an api-version-too-new plugin with both versions named", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("api-too-new") }],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/apiVersion "2\.0\.0"/);
    expect(record.statusReason).toMatch(/"1\.0\.0"/);
  });

  it("load-errors a bad namespace and a reserved namespace at manifest validation", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [
        { path: fixturePlugin("bad-namespace") },
        { path: fixturePlugin("reserved-namespace") },
      ],
    });
    const byName = new Map(registry.listPlugins().map((r) => [r.name, r]));
    const bad = byName.get("docsxai-plugin-bad-namespace-fixture")!;
    expect(bad.status).toBe("load-error");
    expect(bad.statusReason).toMatch(/namespace must match/);
    const reserved = byName.get("docsxai-plugin-reserved-namespace-fixture")!;
    expect(reserved.status).toBe("load-error");
    expect(reserved.statusReason).toMatch(/reserved/);
  });

  it("load-errors and rolls back a plugin registering an undeclared kind", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("undeclared-kind") }],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/registered a "renderer"/);
    expect(record.statusReason).toMatch(/\[publisher\]/);
    expect(record.artifacts).toEqual([]);
    // The publisher it registered before the violation must not survive the rollback.
    expect(() => registry.getPublisher("sneaky:honest")).toThrow(PluginRegistryError);
  });

  it("disables BOTH members of a dependsOn cycle", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("cycle-a") }, { path: fixturePlugin("cycle-b") }],
    });
    const records = registry.listPlugins();
    expect(records.map((r) => r.status)).toEqual(["disabled-by-cycle", "disabled-by-cycle"]);
    for (const r of records) {
      expect(r.statusReason).toMatch(
        /docsxai-plugin-cycle-a-fixture → docsxai-plugin-cycle-b-fixture/,
      );
    }
  });

  it("disables a plugin whose dependsOn target is not configured", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("dep-missing") }],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("disabled-by-dep-missing");
    expect(record.statusReason).toMatch(/docsxai-plugin-nonexistent/);
  });

  it("disables a plugin whose dependency version does not satisfy the range", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("dep-version") }, { path: fixturePlugin("multi-kind") }],
    });
    const byNs = new Map(registry.listPlugins().map((r) => [r.namespace, r]));
    const picky = byNs.get("picky")!;
    expect(picky.status).toBe("disabled-by-dep-missing");
    expect(picky.statusReason).toMatch(/1\.2\.3 does not satisfy the declared range "\^9\.0\.0"/);
    expect(byNs.get("multi")!.status).toBe("loaded");
  });

  it("disables a capability-mismatched plugin without failing the resolve", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("needs-egress") }, { path: fixturePlugin("multi-kind") }],
    });
    const byNs = new Map(registry.listPlugins().map((r) => [r.namespace, r]));
    const egressy = byNs.get("egressy")!;
    expect(egressy.status).toBe("disabled-by-capability-mismatch");
    expect(egressy.statusReason).toMatch(/egress:\*\.example\.com/);
    expect(byNs.get("multi")!.status).toBe("loaded");
  });

  it("loads a capability-declared CJS plugin once the operator enables the capability", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("needs-egress") }],
      enabledCapabilities: ["egress:*.example.com"],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("loaded");
    expect(record.artifacts).toEqual([{ kind: "publisher", name: "egressy:wiki" }]);
    expect(registry.getPublisher("egressy:wiki")).toBeDefined();
  });

  it("conflict-disables BOTH claimants of a duplicate namespace", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }, { path: fixturePlugin("multi-clone") }],
    });
    const records = registry.listPlugins();
    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.status).toBe("disabled-by-namespace-conflict");
      expect(r.statusReason).toMatch(/namespace "multi"/);
    }
    expect(() => registry.getPublisher("multi:wiki")).toThrow(PluginRegistryError);
  });

  it("load-errors both entries when the same package is configured twice", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: fixturePlugin("multi-kind") }, { path: fixturePlugin("multi-kind") }],
    });
    const records = registry.listPlugins();
    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.status).toBe("load-error");
      expect(r.statusReason).toMatch(/configured more than once/);
    }
  });

  it("load-errors an uninstalled package source and a missing path source", async () => {
    const ws = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [
        { package: "docsxai-plugin-definitely-not-installed" },
        { path: path.join(ws, "no-such-dir") },
      ],
    });
    const records = registry.listPlugins();
    expect(records).toHaveLength(2);
    const reasons = records.map((r) => r.statusReason ?? "");
    expect(
      reasons.some((m) =>
        /cannot resolve package "docsxai-plugin-definitely-not-installed"/.test(m),
      ),
    ).toBe(true);
    expect(reasons.some((m) => /plugin path does not exist/.test(m))).toBe(true);
  });

  it("load-errors a package whose package.json has no docsxai field", async () => {
    const ws = await makeWorkspace();
    const enginePackageDir = path.resolve(PLUGIN_FIXTURES_DIR, "..", "..", "..");
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: [{ path: enginePackageDir }],
    });
    const record = registry.listPlugins()[0]!;
    expect(record.status).toBe("load-error");
    expect(record.statusReason).toMatch(/no "docsxai" field/);
  });
});
