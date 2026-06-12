// End-to-end webhook fixture: a realistically-shaped signed GitHub push event goes through the
// full path — signature gate → repo→project mapping → queue → SpawnRunner with a fake engine bin
// → pr-comment strategy against a fake GitHub API — and lands a run-history row.

import * as fs from "node:fs";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunRecord } from "../src/api.js";
import {
  createBackendStub,
  QueuedDispatcher,
  signGitHubPayload,
  SpawnRunner,
} from "../src/index.js";

const TOKEN = "test-token";
const SECRET = "e2e-webhook-secret";
const FAKE_BIN = fileURLToPath(new URL("./fixtures/fake-engine.cjs", import.meta.url));
const PUSH_FIXTURE = fs.readFileSync(
  new URL("./fixtures/push-event.json", import.meta.url),
  "utf8",
);

let stub: ReturnType<typeof createBackendStub>;
let dispatcher: QueuedDispatcher;
let base = "";
let wsId = "";
let projectId = "";

let ghServer: http.Server;
let ghBase = "";
const ghPosts: Array<{ url: string; body: string }> = [];

const h = () => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });

beforeAll(async () => {
  ghServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      ghPosts.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: ghPosts.length }));
    });
  });
  ghBase = await new Promise<string>((resolve) => {
    ghServer.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(ghServer.address() as { port: number }).port}`);
    });
  });

  // One service: the dispatcher reuses the server's store directly (same process). The runner
  // needs the stub's store, so it is created right after the stub and threaded via a ref.
  const runnerRef: { current?: SpawnRunner } = {};
  dispatcher = new QueuedDispatcher(async (job) => {
    await runnerRef.current!.executeRun(job);
  });
  stub = createBackendStub({
    token: TOKEN,
    dispatcher,
    env: { DOCSX_WEBHOOK_SECRET: SECRET },
  });
  runnerRef.current = new SpawnRunner({
    store: stub.store,
    engineBin: FAKE_BIN,
    strategyDeps: {
      githubApiBase: ghBase,
      env: { GITHUB_APP_TOKEN: "installation-token" },
    },
  });
  base = await stub.listen(0);

  // Seed: workspace → project → revision with a flows artifact → finalize → webhook config.
  const ws = (await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "e2e-ws" }),
    })
  ).json()) as { id: string };
  wsId = ws.id;
  const project = (await (
    await fetch(`${base}/v1/workspaces/${wsId}/projects`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "docs-site" }),
    })
  ).json()) as { id: string };
  projectId = project.id;
  const rev = (await (
    await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/revisions`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ kind: "calibrate", author: "e2e" }),
    })
  ).json()) as { id: string };
  await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/revisions/${rev.id}/flows`, {
    method: "PUT",
    headers: h(),
    body: JSON.stringify({ flows: [{ id: "checkout" }] }),
  });
  await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/revisions/${rev.id}/finalize`, {
    method: "POST",
    headers: h(),
  });
  const cfg = await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/webhook-config`, {
    method: "PUT",
    headers: h(),
    body: JSON.stringify({
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "pr-comment",
    }),
  });
  expect(cfg.status).toBe(200);
});
afterAll(async () => {
  await stub.close();
  ghServer.close();
});

describe("signed push event end-to-end", () => {
  it("202s, drains the queue, runs the fake engine, comments on the commit, records run-history", async () => {
    const res = await fetch(`${base}/v1/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "e2e-delivery-0001",
        "x-hub-signature-256": signGitHubPayload(SECRET, PUSH_FIXTURE),
      },
      body: PUSH_FIXTURE,
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      delivery_id: "e2e-delivery-0001",
      project_id: projectId,
      dispatched: true,
    });

    await dispatcher.drain();

    // The pr-comment strategy hit the (fake) GitHub API with the push head commit.
    expect(ghPosts).toHaveLength(1);
    expect(ghPosts[0]!.url).toBe(
      "/repos/octo-org/docs-site/commits/59b20b8d5c6ff8d09518454d4dd8b7b30f095ab5/comments",
    );
    expect(ghPosts[0]!.body).toContain("docsxai run passed");

    // The run-history row exists and carries the engine + strategy outcome.
    const runs = (await (
      await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/run-history`, {
        headers: h(),
      })
    ).json()) as RunRecord[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: true, project_id: projectId });
    expect(runs[0]!.summary).toContain("[webhook push e2e-delivery-0001]");
    expect(runs[0]!.summary).toContain("documented 3 flows");
    expect(runs[0]!.summary).toContain("commented on commit");
  });

  it("a replayed delivery is acknowledged as duplicate and triggers nothing new", async () => {
    const res = await fetch(`${base}/v1/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "e2e-delivery-0001",
        "x-hub-signature-256": signGitHubPayload(SECRET, PUSH_FIXTURE),
      },
      body: PUSH_FIXTURE,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    await dispatcher.drain();
    expect(ghPosts).toHaveLength(1); // unchanged

    const runs = (await (
      await fetch(`${base}/v1/workspaces/${wsId}/projects/${projectId}/run-history`, {
        headers: h(),
      })
    ).json()) as RunRecord[];
    expect(runs).toHaveLength(1); // unchanged
  });

  it("a tampered body fails the signature gate", async () => {
    const tampered = PUSH_FIXTURE.replace("update checkout flow copy", "malicious");
    const res = await fetch(`${base}/v1/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "e2e-delivery-0002",
        "x-hub-signature-256": signGitHubPayload(SECRET, PUSH_FIXTURE), // signature of the ORIGINAL
      },
      body: tampered,
    });
    expect(res.status).toBe(401);
  });
});
