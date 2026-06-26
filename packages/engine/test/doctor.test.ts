// `docsxai doctor` — per-check state coverage. Every check is a pure(ish) function over
// injectable inputs (fixture workspaces, a fake backend, a mocked chromium probe), plus one
// chromium-gated probe of the real playwright-core path and a CLI-dispatch smoke test.

import { createBackendStub } from "@docsxai/backend";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  buildDoctorChecks,
  checkAuth,
  checkBackend,
  checkChromium,
  checkEnv,
  checkFlows,
  checkNode,
  checkPlugins,
  checkViewer,
  checkWorkspace,
  formatDoctorChecks,
  probeChromium,
} from "../src/doctor.js";
import { PLUGINS_LOCK_SCHEMA, sha256Hex } from "../src/plugins/lock.js";
import { cleanupWorkspaces, makeWorkspace, writeTempPlugin } from "./plugins-helpers.js";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const NOW = Date.parse("2026-06-12T12:00:00.000Z");

const CLEAN_FLOW = `name: clean
locators: { btn: '#btn' }
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

const DESCRIPTOR = `schema: docsxai/auth-strategy@1
default_role: editor
roles:
  editor:
    strategy: manual-capture
    options: { capture_trigger: console }
    cache: { enabled: true, store: local, ttl: 1h }
`;

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});
afterAll(async () => {
  await cleanupWorkspaces();
});

describe("checkNode", () => {
  it("passes on Node >= 20", () => {
    const c = checkNode("20.11.0");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("v20.11.0");
  });

  it("fails on Node < 20 with an upgrade fix", () => {
    const c = checkNode("18.19.1");
    expect(c.ok).toBe(false);
    expect(c.fix).toMatch(/upgrade Node/);
  });
});

describe("checkChromium", () => {
  it("passes when the probe finds a binary", async () => {
    const c = await checkChromium(async () => ({ ok: true, detail: "/some/chromium" }));
    expect(c.ok).toBe(true);
    expect(c.detail).toBe("/some/chromium");
  });

  it("fails with the documented install hint when the probe misses", async () => {
    const c = await checkChromium(async () => ({ ok: false, detail: "no binary cached" }));
    expect(c.ok).toBe(false);
    expect(c.fix).toMatch(/npx playwright-core install chromium/);
    expect(c.fix).toMatch(/pnpm -C packages\/engine exec playwright-core install chromium/);
  });

  it.skipIf(!chromiumAvailable)("real probe finds the installed Chromium", () => {
    const r = probeChromium();
    expect(r.ok).toBe(true);
    expect(existsSync(r.detail)).toBe(true);
  });
});

describe("checkWorkspace", () => {
  it("is informational when no .docsxai.json exists", async () => {
    const ws = await checkWorkspace(tmp);
    expect(ws.check.ok).toBe(true);
    expect(ws.check.info).toBe(true);
    expect(ws.present).toBe(false);
    expect(ws.check.detail).toMatch(/not a docsxai workspace/);
  });

  it("treats flows/ without a config as a workspace missing its config", async () => {
    await fs.mkdir(path.join(tmp, "flows"));
    const ws = await checkWorkspace(tmp);
    expect(ws.check.info).toBe(true);
    expect(ws.present).toBe(true);
    expect(ws.check.detail).toMatch(/docsxai init/);
  });

  it("fails on malformed JSON", async () => {
    await fs.writeFile(path.join(tmp, ".docsxai.json"), "{nope", "utf8");
    const ws = await checkWorkspace(tmp);
    expect(ws.check.ok).toBe(false);
    expect(ws.check.detail).toMatch(/not valid JSON/);
  });

  it("fails on an unexpected schema", async () => {
    await fs.writeFile(path.join(tmp, ".docsxai.json"), JSON.stringify({ schema: "nope@9" }));
    const ws = await checkWorkspace(tmp);
    expect(ws.check.ok).toBe(false);
    expect(ws.check.detail).toMatch(/docsxai\/workspace@1/);
  });

  it("passes on a valid config and surfaces app_url", async () => {
    await fs.writeFile(
      path.join(tmp, ".docsxai.json"),
      JSON.stringify({ schema: "docsxai/workspace@1", app_url: "https://app.example.com" }),
    );
    const ws = await checkWorkspace(tmp);
    expect(ws.check.ok).toBe(true);
    expect(ws.check.info).toBeUndefined();
    expect(ws.check.detail).toContain("app_url https://app.example.com");
    expect(ws.config?.app_url).toBe("https://app.example.com");
  });
});

describe("checkFlows", () => {
  it("fails when flows/ is missing", async () => {
    const c = await checkFlows(tmp);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/no flows\/ directory/);
  });

  it("is informational when flows/ is empty", async () => {
    await fs.mkdir(path.join(tmp, "flows"));
    const c = await checkFlows(tmp);
    expect(c.ok).toBe(true);
    expect(c.info).toBe(true);
  });

  it("counts parsing flow-files", async () => {
    await fs.mkdir(path.join(tmp, "flows"));
    await fs.writeFile(path.join(tmp, "flows", "a.flow.yaml"), CLEAN_FLOW, "utf8");
    await fs.writeFile(path.join(tmp, "flows", "b.flow.yaml"), CLEAN_FLOW, "utf8");
    const c = await checkFlows(tmp);
    expect(c.ok).toBe(true);
    expect(c.detail).toBe("2 flow-file(s) parse");
  });

  it("fails with the first parse error", async () => {
    await fs.mkdir(path.join(tmp, "flows"));
    await fs.writeFile(path.join(tmp, "flows", "bad.flow.yaml"), "name: [broken", "utf8");
    const c = await checkFlows(tmp);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/bad\.flow\.yaml does not parse/);
    expect(c.fix).toMatch(/docsxai lint/);
  });
});

describe("checkAuth", () => {
  async function withDescriptor(): Promise<void> {
    await fs.mkdir(path.join(tmp, "auth"), { recursive: true });
    await fs.writeFile(path.join(tmp, "auth", "strategy.yaml"), DESCRIPTOR, "utf8");
  }

  it("is informational when no descriptor exists", async () => {
    const checks = await checkAuth(tmp, NOW);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.info).toBe(true);
    expect(checks[0]!.detail).toMatch(/unauthenticated/);
  });

  it("fails on an unparseable descriptor", async () => {
    await fs.mkdir(path.join(tmp, "auth"), { recursive: true });
    await fs.writeFile(path.join(tmp, "auth", "strategy.yaml"), "default_role: ghost", "utf8");
    const checks = await checkAuth(tmp, NOW);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(false);
    expect(checks[0]!.fix).toMatch(/auth\/strategy\.yaml/);
  });

  it("notes a missing cached session with the capture-auth hint", async () => {
    await withDescriptor();
    const checks = await checkAuth(tmp, NOW);
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).toMatch(/default "editor", strategy manual-capture/);
    expect(checks[1]!.info).toBe(true);
    expect(checks[1]!.detail).toMatch(/docsxai capture-auth/);
  });

  it("fails on an expired cached session with the capture-auth fix", async () => {
    await withDescriptor();
    await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".auth", "editor.json"),
      JSON.stringify({
        storageState: { cookies: [], origins: [] },
        writtenAt: NOW - 7_200_000,
        expiresAt: NOW - 3_600_000,
      }),
      "utf8",
    );
    const checks = await checkAuth(tmp, NOW);
    expect(checks[1]!.ok).toBe(false);
    expect(checks[1]!.detail).toMatch(/expired 2026-06-12T11:00:00\.000Z/);
    expect(checks[1]!.fix).toMatch(/docsxai capture-auth/);
  });

  it("fails on a corrupt cached session", async () => {
    await withDescriptor();
    await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".auth", "editor.json"), "{nope", "utf8");
    const checks = await checkAuth(tmp, NOW);
    expect(checks[1]!.ok).toBe(false);
    expect(checks[1]!.detail).toMatch(/corrupt/);
  });

  it("passes on a fresh cached session", async () => {
    await withDescriptor();
    await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".auth", "editor.json"),
      JSON.stringify({
        storageState: { cookies: [], origins: [] },
        writtenAt: NOW,
        expiresAt: NOW + 3_600_000,
      }),
      "utf8",
    );
    const checks = await checkAuth(tmp, NOW);
    expect(checks[1]!.ok).toBe(true);
    expect(checks[1]!.detail).toMatch(/valid until 2026-06-12T13:00:00\.000Z/);
  });
});

describe("checkBackend", () => {
  it("is informational when no backend_url is configured", async () => {
    const c = await checkBackend(tmp, { schema: "docsxai/workspace@1" }, {}, fetch);
    expect(c.ok).toBe(true);
    expect(c.info).toBe(true);
    expect(c.detail).toMatch(/operates fully locally/);
  });

  it("passes against a live backend and notes DOCSX_TOKEN", async () => {
    const stub = createBackendStub({ token: "doctor-token" });
    const base = await stub.listen(0);
    try {
      const c = await checkBackend(
        tmp,
        { backend_url: base },
        { DOCSX_TOKEN: "doctor-token" },
        fetch,
      );
      expect(c.ok).toBe(true);
      expect(c.detail).toContain("/v1/health ok");
      expect(c.detail).toContain("token: DOCSX_TOKEN set");
    } finally {
      await stub.close();
    }
  });

  it("notes a stored OAuth token file when DOCSX_TOKEN is unset", async () => {
    const stub = createBackendStub({ token: "doctor-token" });
    const base = await stub.listen(0);
    await fs.mkdir(path.join(tmp, ".auth"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".auth", "backend-token.json"), "{}", "utf8");
    try {
      const c = await checkBackend(tmp, { backend_url: base }, {}, fetch);
      expect(c.ok).toBe(true);
      expect(c.detail).toContain("OAuth tokens at .auth/backend-token.json");
    } finally {
      await stub.close();
    }
  });

  it("notes a missing token without failing the health check", async () => {
    const stub = createBackendStub({ token: "doctor-token" });
    const base = await stub.listen(0);
    try {
      const c = await checkBackend(tmp, { backend_url: base }, {}, fetch);
      expect(c.ok).toBe(true);
      expect(c.detail).toMatch(/no token — push\/pull need DOCSX_TOKEN/);
    } finally {
      await stub.close();
    }
  });

  it("fails when the backend is unreachable", async () => {
    const c = await checkBackend(tmp, { backend_url: "http://127.0.0.1:1" }, {}, fetch);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/unreachable/);
    expect(c.fix).toMatch(/start the backend/);
  });

  it("fails on a non-2xx health response", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const c = await checkBackend(tmp, { backend_url: "http://x.invalid" }, {}, fakeFetch);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/HTTP 503/);
  });
});

describe("checkPlugins", () => {
  it("is informational when no plugins are configured", async () => {
    const ws = await makeWorkspace();
    const checks = await checkPlugins(ws);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.info).toBe(true);
  });

  it("fails on an invalid plugins config", async () => {
    const ws = await makeWorkspace({ plugins: [{ bogus: true }] });
    const checks = await checkPlugins(ws);
    expect(checks[0]!.ok).toBe(false);
    expect(checks[0]!.fix).toMatch(/plugins/);
  });

  it("flags a configured set with no lock file", async () => {
    const ws = await makeWorkspace();
    const pluginDir = await writeTempPlugin(ws);
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        created_at: "2026-01-01T00:00:00.000Z",
        plugins: [{ path: pluginDir }],
      }),
      "utf8",
    );
    const checks = await checkPlugins(ws);
    expect(checks.some((c) => !c.ok && /plugins-lock\.json missing/.test(c.detail))).toBe(true);
    // The plugin row itself is healthy apart from the pin.
    expect(checks.some((c) => c.ok && /ns=temp, publisher, no lock/.test(c.detail))).toBe(true);
  });

  it("passes a pinned, capability-satisfied plugin (lock ok)", async () => {
    const ws = await makeWorkspace();
    const pluginDir = await writeTempPlugin(ws);
    const registerBytes = await fs.readFile(path.join(pluginDir, "register.mjs"));
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        created_at: "2026-01-01T00:00:00.000Z",
        plugins: [{ path: pluginDir }],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(ws, "plugins-lock.json"),
      JSON.stringify({
        schema: PLUGINS_LOCK_SCHEMA,
        plugins: {
          temp: { source: `path:${pluginDir}`, version: "1.0.0", sha256: sha256Hex(registerBytes) },
        },
      }),
      "utf8",
    );
    const checks = await checkPlugins(ws);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).toMatch(/ns=temp, publisher, lock ok/);
  });

  it("fails on a lock mismatch with the sync-after-audit fix", async () => {
    const ws = await makeWorkspace();
    const pluginDir = await writeTempPlugin(ws);
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        created_at: "2026-01-01T00:00:00.000Z",
        plugins: [{ path: pluginDir }],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(ws, "plugins-lock.json"),
      JSON.stringify({
        schema: PLUGINS_LOCK_SCHEMA,
        plugins: {
          temp: { source: `path:${pluginDir}`, version: "1.0.0", sha256: "0".repeat(64) },
        },
      }),
      "utf8",
    );
    const checks = await checkPlugins(ws);
    expect(checks.some((c) => !c.ok && /lock mismatch/.test(c.detail))).toBe(true);
  });

  it("fails on an unresolvable source", async () => {
    const ws = await makeWorkspace({ plugins: [{ path: "./does-not-exist" }] });
    const checks = await checkPlugins(ws);
    expect(checks.some((c) => !c.ok && /does not exist/.test(c.detail))).toBe(true);
  });

  it("fails on a declared capability the workspace has not enabled", async () => {
    const ws = await makeWorkspace();
    const pluginDir = path.join(ws, "plugin-egress");
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify({
        name: "docsxai-plugin-egress-temp",
        version: "1.0.0",
        type: "module",
        docsxai: {
          apiVersion: "1.0.0",
          namespace: "egress",
          register: "./register.mjs",
          kinds: ["publisher"],
          capabilities: ["egress:example.com"],
        },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(pluginDir, "register.mjs"), "export function register() {}\n");
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        created_at: "2026-01-01T00:00:00.000Z",
        plugins: [{ path: pluginDir }],
      }),
      "utf8",
    );
    const checks = await checkPlugins(ws);
    expect(
      checks.some(
        (c) => !c.ok && /capability\(ies\) \[egress:example\.com\] not enabled/.test(c.detail),
      ),
    ).toBe(true);
    expect(checks.some((c) => !c.ok && /plugin_capabilities/.test(c.fix ?? ""))).toBe(true);
  });
});

describe("checkViewer", () => {
  it("names layer 1 when DOCSX_VIEWER_BIN resolves", async () => {
    const bin = path.join(tmp, "viewer.mjs");
    await fs.writeFile(bin, "export {};\n", "utf8");
    const c = await checkViewer({ DOCSX_VIEWER_BIN: bin, PATH: "" });
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("layer 1: env override");
  });

  it("names layer 2 when the package is installed next to the engine", async () => {
    const pkgDir = path.join(tmp, "node_modules", "@docsxai", "viewer");
    await fs.mkdir(path.join(pkgDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@docsxai/viewer", bin: { "docsxai-viewer": "./dist/index.js" } }),
      "utf8",
    );
    await fs.writeFile(path.join(pkgDir, "dist", "index.js"), "", "utf8");
    const c = await checkViewer({ PATH: "" }, [tmp]);
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("layer 2: installed package");
  });

  it("names layer 3 when the bin is on PATH", async () => {
    const binDir = path.join(tmp, "bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, "docsxai-viewer"), "#!/bin/sh\n", { mode: 0o755 });
    const c = await checkViewer({ PATH: binDir }, [path.join(tmp, "empty")]);
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("layer 3: PATH");
  });

  it("fails with all three layers named when nothing resolves", async () => {
    const c = await checkViewer({ PATH: path.join(tmp, "nothing") }, [path.join(tmp, "empty")]);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/DOCSX_VIEWER_BIN.*@docsxai\/viewer.*PATH/);
    expect(c.fix).toMatch(/install @docsxai\/viewer/);
  });
});

describe("checkEnv", () => {
  it("is informational when nothing is set", () => {
    const checks = checkEnv({ HOME: "/home/x" });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.info).toBe(true);
  });

  it("lists recognised DOCSX_* vars without echoing values", () => {
    const checks = checkEnv({ DOCSX_TOKEN: "secret-token-value" });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).toBe("set: DOCSX_TOKEN");
    expect(JSON.stringify(checks)).not.toContain("secret-token-value");
  });

  it("accepts a well-formed DOCSX_CACHE_KEY", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const checks = checkEnv({ DOCSX_CACHE_KEY: key });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("rejects a malformed DOCSX_CACHE_KEY", () => {
    const checks = checkEnv({ DOCSX_CACHE_KEY: "dG9vLXNob3J0" });
    const bad = checks.find((c) => !c.ok);
    expect(bad?.detail).toMatch(/exactly 32 bytes/);
    expect(bad?.fix).toMatch(/openssl rand -base64 32/);
  });

  it("flags an unrecognised DOCSX_* var as a likely typo", () => {
    const checks = checkEnv({ DOCSX_TOKN: "x" });
    const bad = checks.find((c) => !c.ok);
    expect(bad?.detail).toMatch(/DOCSX_TOKN/);
    expect(bad?.fix).toMatch(/known: DOCSX_TOKEN/);
  });
});

describe("buildDoctorChecks + formatDoctorChecks", () => {
  it("assembles a fully green table for a healthy workspace", async () => {
    await fs.mkdir(path.join(tmp, "flows"), { recursive: true });
    await fs.writeFile(path.join(tmp, "flows", "clean.flow.yaml"), CLEAN_FLOW, "utf8");
    await fs.writeFile(
      path.join(tmp, ".docsxai.json"),
      JSON.stringify({ schema: "docsxai/workspace@1", created_at: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    );
    const bin = path.join(tmp, "viewer.mjs");
    await fs.writeFile(bin, "export {};\n", "utf8");
    const checks = await buildDoctorChecks({
      workspaceDir: tmp,
      nodeVersion: "20.11.0",
      chromiumProbe: async () => ({ ok: true, detail: "/fake/chromium" }),
      env: { DOCSX_VIEWER_BIN: bin, PATH: "" },
      now: NOW,
    });
    expect(checks.every((c) => c.ok)).toBe(true);
    const text = formatDoctorChecks(checks);
    expect(text).toContain("docsxai doctor — environment & workspace health");
    expect(text).toContain("✓ node");
    expect(text).toContain("✓ chromium");
    expect(text).toContain("✓ workspace");
    expect(text).toContain("✓ flows");
    expect(text).toContain("− auth"); // no descriptor — informational
    expect(text).toContain("− backend");
    expect(text).toContain("− plugins");
    expect(text).toContain("✓ viewer");
    expect(text).toContain("all checks passed");
  });

  it("skips workspace-scoped checks outside a workspace", async () => {
    const checks = await buildDoctorChecks({
      workspaceDir: tmp,
      nodeVersion: "20.11.0",
      chromiumProbe: async () => ({ ok: true, detail: "/fake/chromium" }),
      env: { PATH: "" },
      now: NOW,
    });
    expect(checks.map((c) => c.name)).not.toContain("flows");
    expect(checks.map((c) => c.name)).not.toContain("backend");
  });

  it("renders ✗ rows with their one-line fix and the failure summary", () => {
    const text = formatDoctorChecks([
      { name: "node", ok: true, detail: "v20.11.0" },
      { name: "chromium", ok: false, detail: "missing", fix: "install it" },
    ]);
    expect(text).toContain("✗ chromium");
    expect(text).toContain("    fix: install it");
    expect(text).toContain("fix the ✗ items above");
  });
});

describe("doctor CLI dispatch", () => {
  let out = "";
  beforeEach(() => {
    out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the checklist and exits 0/1 per the ✗ rows", async () => {
    const code = await main(["doctor", tmp]);
    expect(out).toContain("docsxai doctor — environment & workspace health");
    const hasFailure = /\n {2}✗ /.test(out);
    expect(code).toBe(hasFailure ? 1 : 0);
  });
});
