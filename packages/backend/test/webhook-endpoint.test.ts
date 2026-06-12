import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebhookConfig } from "../src/api.js";
import { createBackendStub } from "../src/index.js";
import { signGitHubPayload, type RunDispatcher, type WebhookJob } from "../src/webhook.js";

const TOKEN = "test-token";
const SECRET = "hook-secret-123";
const PUSH_FIXTURE = fs.readFileSync(
  new URL("./fixtures/push-event.json", import.meta.url),
  "utf8",
);
const REPO = "octo-org/docs-site";

let stub: ReturnType<typeof createBackendStub>;
let base = "";
let wsId = "";
let projectId = "";
let dispatched: WebhookJob[] = [];

const recordingDispatcher: RunDispatcher = {
  dispatch: (job) => {
    dispatched.push(job);
    return Promise.resolve();
  },
};

const h = () => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });

async function putConfig(config: Partial<WebhookConfig>): Promise<Response> {
  return fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/webhook-config`, {
    method: "PUT",
    headers: h(),
    body: JSON.stringify({
      repo: REPO,
      events: ["push"],
      strategy: "pr-comment",
      ...config,
    }),
  });
}

interface DeliverOptions {
  body?: string;
  secret?: string;
  signature?: string | null;
  event?: string | null;
  delivery?: string | null;
}

async function deliver(opts: DeliverOptions = {}): Promise<Response> {
  const body = opts.body ?? PUSH_FIXTURE;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== null) {
    headers["x-hub-signature-256"] =
      opts.signature ?? signGitHubPayload(opts.secret ?? SECRET, body);
  }
  if (opts.event !== null) headers["x-github-event"] = opts.event ?? "push";
  if (opts.delivery !== null) {
    headers["x-github-delivery"] = opts.delivery ?? crypto.randomUUID();
  }
  return fetch(`${base}/v1/github/webhook`, { method: "POST", headers, body });
}

beforeEach(async () => {
  dispatched = [];
  stub = createBackendStub({
    token: TOKEN,
    dispatcher: recordingDispatcher,
    env: { SITE_DOCS_WEBHOOK_SECRET: SECRET },
  });
  base = await stub.listen(0);
  const ws = (await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "ws" }),
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
  await putConfig({});
});
afterEach(async () => {
  await stub.close();
});

describe("POST /v1/github/webhook", () => {
  it("accepts a correctly signed configured event with 202 and dispatches the job", async () => {
    const res = await deliver({ delivery: "delivery-1" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      delivery_id: "delivery-1",
      project_id: projectId,
      dispatched: true,
    });
    expect(dispatched).toHaveLength(1);
    const job = dispatched[0]!;
    expect(job).toMatchObject({
      delivery_id: "delivery-1",
      event: "push",
      workspace_id: wsId,
      project_id: projectId,
      repo: REPO,
    });
    expect((job.payload as { after: string }).after).toBe(
      "59b20b8d5c6ff8d09518454d4dd8b7b30f095ab5",
    );
  });

  it("rejects a signature made with the wrong secret (401, nothing dispatched)", async () => {
    const res = await deliver({ secret: "wrong-secret" });
    expect(res.status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a missing signature header", async () => {
    expect((await deliver({ signature: null })).status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a malformed signature header", async () => {
    expect((await deliver({ signature: "sha256=zz" })).status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("fails closed when the configured secret env var is unset", async () => {
    await putConfig({ secret_env: "UNSET_WEBHOOK_SECRET_ENV" });
    expect((await deliver({})).status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("404s for a repo no project is configured for", async () => {
    const payload = JSON.parse(PUSH_FIXTURE) as { repository: { full_name: string } };
    payload.repository.full_name = "octo-org/unknown-repo";
    const res = await deliver({ body: JSON.stringify(payload) });
    expect(res.status).toBe(404);
    expect(dispatched).toHaveLength(0);
  });

  it("400s when the payload has no repository.full_name", async () => {
    const res = await deliver({ body: JSON.stringify({ zen: "Design for failure." }) });
    expect(res.status).toBe(400);
  });

  it("acknowledges but filters events the config does not subscribe to", async () => {
    const res = await deliver({ event: "pull_request", delivery: "filtered-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dispatched: false, reason: "event-filtered" });
    expect(dispatched).toHaveLength(0);
  });

  it("acknowledges but skips dispatch when the config is disabled", async () => {
    await putConfig({ enabled: false });
    const res = await deliver({});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dispatched: false, reason: "disabled" });
    expect(dispatched).toHaveLength(0);
  });

  it("400s when X-GitHub-Delivery is missing", async () => {
    expect((await deliver({ delivery: null })).status).toBe(400);
  });

  it("deduplicates redelivered delivery ids (200 duplicate, single dispatch)", async () => {
    expect((await deliver({ delivery: "replay-me" })).status).toBe(202);
    const dup = await deliver({ delivery: "replay-me" });
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ duplicate: true, dispatched: false });
    expect(dispatched).toHaveLength(1);
  });

  it("does not require a bearer token (webhook is signature-gated, not bearer-gated)", async () => {
    // beforeEach's deliver() calls never set Authorization; this asserts it explicitly.
    const res = await deliver({ delivery: "no-bearer" });
    expect(res.status).toBe(202);
  });
});
