// Contract: the plugin API (publishers, renderers, lint rules, auth strategies), the plugin
// manifest (the `docsxai` key of a plugin's package.json), the runtime API version, the status
// vocabulary of `docsxai plugins list --format json`, `plugins-lock.json`, and the plugin keys of
// `.docsxai.json`.
//
// Snapshot: snapshots/plugin-api.json. The extension-point types are TypeScript interfaces, so
// they are read from source text (syntax only). The manifest shape is derived by parsing a full
// manifest with each key removed in turn, so required and optional keys come from the real schema.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A changed member of an extension-point type, a removed manifest
//      key, a removed status or a new required manifest key breaks existing plugins and needs a
//      `RUNTIME_API_VERSION` decision (major bump for a break, minor for an addition).
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectJsonSnapshot,
  stringUnion,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import {
  PLUGIN_KINDS,
  PluginManifestError,
  RESERVED_NAMESPACES,
  RUNTIME_API_VERSION,
  isApiVersionCompatible,
  parsePluginManifest,
  satisfiesRange,
} from "../../src/plugins/manifest.js";
import {
  PLUGINS_LOCK_FILE,
  PLUGINS_LOCK_SCHEMA,
  PluginsConfigError,
  PluginsLockError,
  readPluginsLock,
  readWorkspacePluginsConfig,
  writePluginsLock,
} from "../../src/plugins/lock.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "src");
const pluginTypes = path.join(src, "plugins", "types.ts");
const registrySource = path.join(src, "plugins", "registry.ts");
const loadSource = path.join(src, "plugins", "load.ts");
const lockSource = path.join(src, "plugins", "lock.ts");
const lintSource = path.join(src, "flow-lint.ts");

const FULL_MANIFEST: Record<string, unknown> = {
  apiVersion: "1.0.0",
  namespace: "demo",
  register: "./register.js",
  kinds: ["publisher"],
  capabilities: ["egress:example.com"],
  dependsOn: [{ plugin: "other", version: "^1.0.0" }],
  trust: "community",
};

/** Which manifest keys are required, derived by removing each key from a valid manifest. */
function manifestKeyRoles(): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  for (const key of Object.keys(FULL_MANIFEST)) {
    const without = { ...FULL_MANIFEST };
    delete without[key];
    try {
      parsePluginManifest(without, "contract");
      optional.push(key);
    } catch {
      required.push(key);
    }
  }
  return { required: required.sort(), optional: optional.sort() };
}

function manifestDefaults(): Record<string, unknown> {
  const minimal = parsePluginManifest(
    { apiVersion: "1.0.0", namespace: "demo", register: "./register.js", kinds: ["renderer"] },
    "contract",
  );
  return { capabilities: minimal.capabilities, dependsOn: minimal.dependsOn, trust: minimal.trust };
}

describe("plugin API contract", () => {
  it("matches the checked-in plugin API snapshot", () => {
    expectJsonSnapshot(path.join(here, "snapshots", "plugin-api.json"), {
      runtimeApiVersion: RUNTIME_API_VERSION,
      reservedNamespaces: [...RESERVED_NAMESPACES],
      kinds: [...PLUGIN_KINDS],
      trust: stringUnion(path.join(src, "plugins", "manifest.ts"), "PluginTrust"),
      statuses: stringUnion(registrySource, "PluginStatus"),
      manifest: { ...manifestKeyRoles(), defaults: manifestDefaults() },
      lock: { file: PLUGINS_LOCK_FILE, schema: PLUGINS_LOCK_SCHEMA },
      configKeys: ["plugins", "plugin_capabilities"],
      types: {
        PluginLogger: typeMembers(pluginTypes, "PluginLogger"),
        PublisherContext: typeMembers(pluginTypes, "PublisherContext"),
        PublishResult: typeMembers(pluginTypes, "PublishResult"),
        PublisherPlugin: typeMembers(pluginTypes, "PublisherPlugin"),
        RendererContext: typeMembers(pluginTypes, "RendererContext"),
        RendererResult: typeMembers(pluginTypes, "RendererResult"),
        RendererPlugin: typeMembers(pluginTypes, "RendererPlugin"),
        AuthStrategyPlugin: typeMembers(pluginTypes, "AuthStrategyPlugin"),
        PluginRegisterApi: typeMembers(loadSource, "PluginRegisterApi"),
        PluginRecord: typeMembers(registrySource, "PluginRecord"),
        PluginArtifact: typeMembers(registrySource, "PluginArtifact"),
        PluginsLockFile: typeMembers(lockSource, "PluginsLockFile"),
        PluginsLockEntry: typeMembers(lockSource, "PluginsLockEntry"),
        LintRule: typeMembers(lintSource, "LintRule"),
        LintIssue: typeMembers(lintSource, "LintIssue"),
        LintOptions: typeMembers(lintSource, "LintOptions"),
      },
      lintSeverities: stringUnion(lintSource, "LintSeverity"),
    });
  });
});

describe("plugin manifest behaviour contract", () => {
  const base = { apiVersion: "1.0.0", namespace: "demo", register: "./register.js" };

  it("rejects an unknown manifest key and an empty kinds list", () => {
    expect(() => parsePluginManifest({ ...base, kinds: ["publisher"], extra: 1 }, "t")).toThrow(
      PluginManifestError,
    );
    expect(() => parsePluginManifest({ ...base, kinds: [] }, "t")).toThrow(PluginManifestError);
  });

  it.each([...RESERVED_NAMESPACES])("rejects the reserved namespace %s", (ns) => {
    expect(() =>
      parsePluginManifest({ ...base, namespace: ns, kinds: ["publisher"] }, "t"),
    ).toThrow(/reserved/);
  });

  it("accepts an egress capability and rejects any other capability family", () => {
    const ok = parsePluginManifest(
      { ...base, kinds: ["publisher"], capabilities: ["egress:*.atlassian.net"] },
      "t",
    );
    expect(ok.capabilities).toEqual(["egress:*.atlassian.net"]);
    expect(() =>
      parsePluginManifest({ ...base, kinds: ["publisher"], capabilities: ["fs:write"] }, "t"),
    ).toThrow(PluginManifestError);
  });

  it("requires the plugin's apiVersion to share the runtime's major and not exceed its minor", () => {
    expect(isApiVersionCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isApiVersionCompatible("1.0.0", "1.4.2")).toBe(true);
    expect(isApiVersionCompatible("1.5.0", "1.4.2")).toBe(false);
    expect(isApiVersionCompatible("2.0.0", "1.4.2")).toBe(false);
    expect(isApiVersionCompatible("0.9.0", "1.4.2")).toBe(false);
  });

  it("supports exact, tilde and caret ranges in dependsOn", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.9.0", "^1.2.3")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3")).toBe(false);
  });
});

describe("plugins-lock.json and plugin config behaviour contract", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-contract-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes the lock with sorted plugin names, two-space indent and a trailing newline", async () => {
    await writePluginsLock(dir, {
      schema: PLUGINS_LOCK_SCHEMA,
      plugins: {
        zeta: { source: "package:zeta", version: "1.0.0", sha256: "bb" },
        alpha: { source: "path:/plugins/alpha", version: "0.1.0", sha256: "aa" },
      },
    });
    const text = await fs.readFile(path.join(dir, PLUGINS_LOCK_FILE), "utf8");
    expect(text).toBe(
      [
        "{",
        '  "schema": "docsxai/plugins-lock@1",',
        '  "plugins": {',
        '    "alpha": {',
        '      "source": "path:/plugins/alpha",',
        '      "version": "0.1.0",',
        '      "sha256": "aa"',
        "    },",
        '    "zeta": {',
        '      "source": "package:zeta",',
        '      "version": "1.0.0",',
        '      "sha256": "bb"',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect((await readPluginsLock(dir))?.plugins["alpha"]?.sha256).toBe("aa");
  });

  it("reads an absent lock as null and rejects a lock with another schema id or an extra key", async () => {
    expect(await readPluginsLock(dir)).toBeNull();
    const file = path.join(dir, PLUGINS_LOCK_FILE);
    await fs.writeFile(file, JSON.stringify({ schema: "docsxai/plugins-lock@2", plugins: {} }));
    await expect(readPluginsLock(dir)).rejects.toThrow(PluginsLockError);
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: PLUGINS_LOCK_SCHEMA,
        plugins: { a: { source: "package:a", version: "1.0.0", sha256: "aa", extra: true } },
      }),
    );
    await expect(readPluginsLock(dir)).rejects.toThrow(PluginsLockError);
  });

  it("reads `plugins` and `plugin_capabilities` from .docsxai.json", async () => {
    const file = path.join(dir, ".docsxai.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: "docsxai/workspace@1",
        plugins: [{ package: "@scope/plugin" }, { path: "./local-plugin" }],
        plugin_capabilities: ["egress:example.com"],
      }),
    );
    expect(await readWorkspacePluginsConfig(dir)).toEqual({
      sources: [{ package: "@scope/plugin" }, { path: "./local-plugin" }],
      capabilities: ["egress:example.com"],
    });
    await fs.writeFile(file, JSON.stringify({ plugins: [{ package: "a", path: "b" }] }));
    await expect(readWorkspacePluginsConfig(dir)).rejects.toThrow(PluginsConfigError);
  });
});
