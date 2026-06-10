import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_VERSION, API_VERSION_HEADER, createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;

const h = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
  ...extra,
});

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
});

describe("backend stub", () => {
  it("serves /v1/health without auth and echoes the API version header", async () => {
    const r = await fetch(`${base}/v1/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: API_VERSION });
    expect(r.headers.get("site-docs-api-version")).toBe(API_VERSION);
  });

  it("401s without a Bearer token, and on a wrong token", async () => {
    expect((await fetch(`${base}/v1/workspaces`)).status).toBe(401);
    expect(
      (await fetch(`${base}/v1/workspaces`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });

  it("creates a workspace → project → revisions (linear, parent-linked) and round-trips an artifact", async () => {
    const ws = await (
      await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ name: "acme" }),
      })
    ).json();
    expect(ws.id).toBeTruthy();

    const proj = await (
      await fetch(`${base}/v1/workspaces/${ws.id}/projects`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ name: "example" }),
      })
    ).json();
    expect(proj.workspace_id).toBe(ws.id);
    expect(proj.head_revision_id).toBeNull();

    const mkRev = () =>
      fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ kind: "calibrate", author: "rowin" }),
      }).then((r) => r.json());
    const rev1 = await mkRev();
    const rev2 = await mkRev();
    expect(rev1.parent_revision_id).toBeNull();
    expect(rev2.parent_revision_id).toBe(rev1.id);

    // head resolves to rev2
    const head = await (
      await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions/head`, {
        headers: h(),
      })
    ).json();
    expect(head.id).toBe(rev2.id);

    // PUT then GET an artifact
    const payload = { schema: "site-docs/annotations@1", flow: "f", annotations: [] };
    const put = await fetch(
      `${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions/${rev2.id}/annotations`,
      {
        method: "PUT",
        headers: h(),
        body: JSON.stringify(payload),
      },
    );
    expect(put.status).toBe(200);
    expect((await put.json()).artifacts).toContain("annotations");
    const got = await (
      await fetch(
        `${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions/${rev2.id}/annotations`,
        { headers: h() },
      )
    ).json();
    expect(got).toEqual(payload);

    // revisions list newest-first
    const list = await (
      await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions`, { headers: h() })
    ).json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([rev2.id, rev1.id]);

    // run history
    const run = await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/run-history`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ rev: "head", ok: true, duration_ms: 1234, summary: "ok" }),
    });
    expect(run.status).toBe(201);
    expect((await run.json()).revision_id).toBe(rev2.id);
    const runs = await (
      await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/run-history`, {
        headers: h(),
      })
    ).json();
    expect(runs).toHaveLength(1);
  });

  it("404s unknown routes/artifacts; 400s a bad revision body", async () => {
    expect((await fetch(`${base}/v1/nope`, { headers: h() })).status).toBe(404);
    const ws = await (
      await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ name: "w2" }),
      })
    ).json();
    const proj = await (
      await fetch(`${base}/v1/workspaces/${ws.id}/projects`, {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ name: "p2" }),
      })
    ).json();
    const bad = await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ kind: "frobnicate" }),
    });
    expect(bad.status).toBe(400);
  });

  it("warns when the client API version mismatches", async () => {
    const r = await fetch(`${base}/v1/health`, { headers: { [API_VERSION_HEADER]: "999" } });
    expect(r.headers.get("warning")).toMatch(/999/);
  });
});
