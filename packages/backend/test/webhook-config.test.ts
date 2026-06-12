import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebhookConfig } from "../src/api.js";
import { createBackendStub, FsStore, MemoryStore, WEBHOOK_DELIVERY_MEMORY } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let wsId = "";
let projectId = "";
let stub: ReturnType<typeof createBackendStub>;

const h = () => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });

const VALID: WebhookConfig = {
  repo: "octo-org/docs-site",
  events: ["push", "pull_request"],
  strategy: "pr-comment",
  workspace_rev: "head",
  secret_env: "SITE_DOCS_WEBHOOK_SECRET",
  enabled: true,
};

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  const ws = (await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "hooks-ws" }),
    })
  ).json()) as { id: string };
  wsId = ws.id;
  const project = (await (
    await fetch(`${base}/v1/workspaces/${wsId}/projects`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "site" }),
    })
  ).json()) as { id: string };
  projectId = project.id;
});
afterAll(async () => {
  await stub.close();
});

const configUrl = (project = projectId) =>
  `${base}/v1/workspaces/${wsId}/projects/${project}/webhook-config`;

const put = (body: unknown) =>
  fetch(configUrl(), { method: "PUT", headers: h(), body: JSON.stringify(body) });

describe("webhook-config CRUD", () => {
  it("requires auth", async () => {
    expect((await fetch(configUrl())).status).toBe(401);
  });

  it("GET before any PUT is 404", async () => {
    const res = await fetch(configUrl(), { headers: h() });
    expect(res.status).toBe(404);
  });

  it("PUT a valid config returns it and GET round-trips", async () => {
    const res = await put(VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
    const got = await fetch(configUrl(), { headers: h() });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(VALID);
  });

  it("PUT applies defaults (workspace_rev, secret_env, enabled)", async () => {
    const res = await put({
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "viewer-refresh",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "viewer-refresh",
      workspace_rev: "head",
      secret_env: "SITE_DOCS_WEBHOOK_SECRET",
      enabled: true,
    });
  });

  it("rejects a malformed repo", async () => {
    expect((await put({ ...VALID, repo: "not-a-repo" })).status).toBe(400);
    expect((await put({ ...VALID, repo: "a/b/c" })).status).toBe(400);
  });

  it("rejects unknown or empty events", async () => {
    expect((await put({ ...VALID, events: [] })).status).toBe(400);
    expect((await put({ ...VALID, events: ["push", "issues"] })).status).toBe(400);
  });

  it("rejects an unknown strategy", async () => {
    expect((await put({ ...VALID, strategy: "carrier-pigeon" })).status).toBe(400);
  });

  it("rejects a non-env-shaped secret_env", async () => {
    expect((await put({ ...VALID, secret_env: "lower case" })).status).toBe(400);
  });

  it("rejects wiki-push without a plugin", async () => {
    expect((await put({ ...VALID, strategy: "wiki-push" })).status).toBe(400);
    const ok = await put({
      ...VALID,
      strategy: "wiki-push",
      plugin: "confluence:push",
      plugin_config: { space: "DOCS" },
    });
    expect(ok.status).toBe(200);
  });

  it("404s for an unknown project", async () => {
    const res = await fetch(configUrl("nope"), {
      method: "PUT",
      headers: h(),
      body: JSON.stringify(VALID),
    });
    expect(res.status).toBe(404);
  });
});

describe("store-level webhook surface", () => {
  it("MemoryStore replay guard dedupes and remembers only the last N ids", () => {
    const store = new MemoryStore();
    expect(store.rememberWebhookDelivery("d-0")).toBe(true);
    expect(store.rememberWebhookDelivery("d-0")).toBe(false);
    for (let i = 1; i <= WEBHOOK_DELIVERY_MEMORY; i++) {
      expect(store.rememberWebhookDelivery(`d-${i}`)).toBe(true);
    }
    // d-0 has been evicted (capacity N) — it counts as new again.
    expect(store.rememberWebhookDelivery("d-0")).toBe(true);
    expect(store.rememberWebhookDelivery(`d-${WEBHOOK_DELIVERY_MEMORY}`)).toBe(false);
  });

  it("FsStore persists configs, repo mapping, and the replay guard across reopen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-docs-webhook-fs-"));
    try {
      const a = new FsStore(dir);
      const ws = a.createWorkspace("ws");
      const project = a.createProject(ws.id, "site");
      a.putWebhookConfig(ws.id, project.id, VALID);
      expect(a.rememberWebhookDelivery("dup-1")).toBe(true);

      const b = new FsStore(dir); // fresh instance over the same data dir
      expect(b.getWebhookConfig(ws.id, project.id)).toEqual(VALID);
      expect(b.findWebhookProject("octo-org/docs-site")).toEqual({
        workspace_id: ws.id,
        project_id: project.id,
        config: VALID,
      });
      expect(b.findWebhookProject("octo-org/other")).toBeNull();
      expect(b.rememberWebhookDelivery("dup-1")).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MemoryStore maps repo to the configured project and hides the config from public reads", () => {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "site");
    expect(store.findWebhookProject(VALID.repo)).toBeNull();
    store.putWebhookConfig(ws.id, project.id, VALID);
    expect(store.findWebhookProject(VALID.repo)?.project_id).toBe(project.id);
    expect(store.getProject(ws.id, project.id)).not.toHaveProperty("webhook_config");
  });
});
