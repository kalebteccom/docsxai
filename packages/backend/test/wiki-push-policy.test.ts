// wiki-push trust boundary: publisher code, the env it sees and the hosts it may send credentials
// to are operator settings. A bearer holder who writes a webhook config must not be able to pick
// the directory the backend import()s, key the webhook HMAC on a known server env var, or point a
// publisher's base_url at their own host.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebhookConfig } from "../src/api.js";
import { createBackendStub, MemoryStore } from "../src/index.js";
import { runStrategy, type StrategyRunInfo } from "../src/strategy.js";
import { signGitHubPayload, type WebhookJob } from "../src/webhook.js";

const RECORDER_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/recorder-plugin", import.meta.url));
const PUSH_FIXTURE = fs.readFileSync(
  new URL("./fixtures/push-event.json", import.meta.url),
  "utf8",
);

function job(pluginConfig: Record<string, unknown> = {}): WebhookJob {
  return {
    delivery_id: "d-policy",
    event: "push",
    workspace_id: "ws",
    project_id: "p",
    repo: "octo-org/docs-site",
    config: {
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "wiki-push",
      workspace_rev: "head",
      secret_env: "DOCSX_WEBHOOK_SECRET",
      enabled: true,
      plugin: "recorder:push",
      plugin_config: pluginConfig,
    },
    payload: {},
  };
}

let workspaceDir = "";
let scratch = "";
let run: StrategyRunInfo;
const published = () => fs.existsSync(path.join(workspaceDir, "publish-call.json"));
const call = () =>
  JSON.parse(fs.readFileSync(path.join(workspaceDir, "publish-call.json"), "utf8")) as {
    secretsEnv: Record<string, string>;
  };

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-policy-ws-"));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-policy-"));
  run = { ok: true, summary: "ok", workspace_dir: workspaceDir };
});
afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("wiki-push publisher directories", () => {
  it("loads publishers from DOCSX_BACKEND_PLUGIN_DIRS", async () => {
    const env = { DOCSX_BACKEND_PLUGIN_DIRS: RECORDER_PLUGIN_DIR };
    const result = await runStrategy(job(), run, { env });
    expect(result.ok).toBe(true);
    expect(published()).toBe(true);
  });

  it("refuses plugin_config.sources from a stored config and loads nothing", async () => {
    const result = await runStrategy(job({ sources: [RECORDER_PLUGIN_DIR] }), run, { env: {} });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("plugin_config.sources");
    expect(published()).toBe(false);
  });

  it("ignores path: plugins in the materialised workspace's docsxai.config.json", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "docsxai.config.json"),
      JSON.stringify({ plugins: [`path:${RECORDER_PLUGIN_DIR}`] }),
    );
    const result = await runStrategy(job(), run, { env: {} });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('publisher "recorder:push" not found');
    expect(published()).toBe(false);
  });

  it("refuses a relative DOCSX_BACKEND_PLUGIN_DIRS entry", async () => {
    const env = { DOCSX_BACKEND_PLUGIN_DIRS: "fixtures/recorder-plugin" };
    await expect(runStrategy(job(), run, { env })).rejects.toThrow(/absolute/);
  });

  it("refuses a register module that resolves outside its plugin directory", async () => {
    const dir = path.join(scratch, "plugin");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(scratch, "evil.mjs"), "export function register() {}\n");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ docsxai: { namespace: "evil", register: "../evil.mjs" } }),
    );
    const env = { DOCSX_BACKEND_PLUGIN_DIRS: dir };
    await expect(runStrategy(job(), run, { env })).rejects.toThrow(/outside/);
  });
});

describe("wiki-push publisher env", () => {
  it("hands the publisher only the env vars named in DOCSX_BACKEND_PUBLISHER_ENV", async () => {
    const env = {
      DOCSX_BACKEND_PLUGIN_DIRS: RECORDER_PLUGIN_DIR,
      DOCSX_BACKEND_PUBLISHER_ENV: "CONFLUENCE_TOKEN, CONFLUENCE_EMAIL",
      CONFLUENCE_TOKEN: "c-token",
      CONFLUENCE_EMAIL: "ops@example.com",
      DOCSX_TOKEN: "ci-token",
      DOCSX_WEBHOOK_SECRET: "hook",
      HOME: "/home/backend",
    };
    expect((await runStrategy(job(), run, { env })).ok).toBe(true);
    expect(call().secretsEnv).toEqual({
      CONFLUENCE_TOKEN: "c-token",
      CONFLUENCE_EMAIL: "ops@example.com",
    });
  });

  it("hands an empty env when no allowlist is set", async () => {
    const env = { DOCSX_BACKEND_PLUGIN_DIRS: RECORDER_PLUGIN_DIR, DOCSX_TOKEN: "ci-token" };
    expect((await runStrategy(job(), run, { env })).ok).toBe(true);
    expect(call().secretsEnv).toEqual({});
  });
});

describe("wiki-push base_url allowlist", () => {
  const env = {
    DOCSX_BACKEND_PLUGIN_DIRS: RECORDER_PLUGIN_DIR,
    DOCSX_BACKEND_PUBLISHER_ORIGINS: "https://acme.atlassian.net",
  };

  it("accepts a base_url on an allowlisted https origin", async () => {
    const result = await runStrategy(job({ base_url: "https://acme.atlassian.net/" }), run, {
      env,
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["https://attacker.example", "not in DOCSX_BACKEND_PUBLISHER_ORIGINS"],
    ["http://acme.atlassian.net", "https"],
    ["https://user:pw@acme.atlassian.net", "credentials"],
    ["not a url", "not a valid URL"],
  ])("refuses base_url %s before loading the publisher", async (url, reason) => {
    const result = await runStrategy(job({ base_url: url }), run, { env });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("plugin_config.base_url");
    expect(result.detail).toContain(reason);
    expect(published()).toBe(false);
  });

  it("applies the same check to other *_url keys", async () => {
    const result = await runStrategy(
      job({ graph_base_url: "https://attacker.example/v1.0" }),
      run,
      { env },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("plugin_config.graph_base_url");
  });

  it("refuses every base_url when no allowlist is set", async () => {
    const result = await runStrategy(job({ base_url: "https://acme.atlassian.net" }), run, {
      env: { DOCSX_BACKEND_PLUGIN_DIRS: RECORDER_PLUGIN_DIR },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("plugin_config.base_url");
  });
});

describe("webhook-config PUT and delivery", () => {
  const TOKEN = "ci-token";
  let stub: ReturnType<typeof createBackendStub>;
  let store: MemoryStore;
  let base = "";
  let wsId = "";
  let projectId = "";
  let dispatched = 0;
  const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  beforeEach(async () => {
    dispatched = 0;
    store = new MemoryStore();
    stub = createBackendStub({
      token: TOKEN,
      store,
      dispatcher: { dispatch: () => Promise.resolve(void dispatched++) },
      env: {
        DOCSX_TOKEN: TOKEN,
        HOME: "/home/backend",
        DOCSX_BACKEND_PUBLISHER_ORIGINS: "https://acme.atlassian.net",
      },
    });
    base = await stub.listen(0);
    wsId = store.createWorkspace("ws").id;
    projectId = store.createProject(wsId, "site").id;
  });
  afterEach(async () => {
    await stub.close();
  });

  const put = async (extra: Partial<WebhookConfig>) => {
    const res = await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/webhook-config`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({
        repo: "octo-org/docs-site",
        events: ["push"],
        strategy: "wiki-push",
        plugin: "confluence:push",
        ...extra,
      }),
    });
    return { status: res.status, body: (await res.json()) as { message?: string } };
  };

  it("400s on plugin_config.sources", async () => {
    const res = await put({ plugin_config: { sources: ["/tmp/x"] } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("plugin_config.sources");
  });

  it.each(["DOCSX_TOKEN", "HOME", "GITHUB_APP_TOKEN"])("400s on secret_env %s", async (name) => {
    const res = await put({ secret_env: name });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("secret_env");
  });

  it("accepts a DOCSX_WEBHOOK_SECRET_<suffix> secret_env", async () => {
    expect((await put({ secret_env: "DOCSX_WEBHOOK_SECRET_SITE" })).status).toBe(200);
  });

  it("400s on a base_url outside DOCSX_BACKEND_PUBLISHER_ORIGINS and accepts one inside", async () => {
    const bad = await put({ plugin_config: { base_url: "https://attacker.example" } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("plugin_config.base_url");
    const ok = await put({ plugin_config: { base_url: "https://acme.atlassian.net" } });
    expect(ok.status).toBe(200);
  });

  it("does not dispatch a stored config whose secret_env names a server env var", async () => {
    store.putWebhookConfig(wsId, projectId, {
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "pr-comment",
      workspace_rev: "head",
      secret_env: "HOME",
      enabled: true,
    });
    const res = await fetch(`${base}/v1/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signGitHubPayload("/home/backend", PUSH_FIXTURE),
        "x-github-event": "push",
        "x-github-delivery": "d-home",
      },
      body: PUSH_FIXTURE,
    });
    expect(res.status).toBe(401);
    expect(dispatched).toBe(0);
  });
});
