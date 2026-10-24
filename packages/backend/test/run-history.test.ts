import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let runsUrl = "";
let stub: ReturnType<typeof createBackendStub>;

const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  const ws = await post(`${base}/v1/workspaces`, { name: "ws" });
  const project = await post(`${base}/v1/workspaces/${ws.json.id}/projects`, { name: "p" });
  const projectUrl = `${base}/v1/workspaces/${ws.json.id}/projects/${project.json.id}`;
  await post(`${projectUrl}/revisions`, { kind: "run", author: "ci" });
  runsUrl = `${projectUrl}/run-history`;
});
afterAll(async () => {
  await stub.close();
});

describe("POST run-history validation", () => {
  it.each([
    ["ok as a string", { rev: "head", ok: "false", duration_ms: 1, summary: "s" }, "ok"],
    ["a missing ok", { rev: "head", duration_ms: 1, summary: "s" }, "ok"],
    ["a text duration", { rev: "head", ok: true, duration_ms: "abc", summary: "s" }, "duration_ms"],
    [
      "a negative duration",
      { rev: "head", ok: true, duration_ms: -5, summary: "s" },
      "duration_ms",
    ],
    ["an object summary", { rev: "head", ok: true, duration_ms: 1, summary: {} }, "summary"],
  ])("400s %s", async (_name, body, field) => {
    const r = await post(runsUrl, body);
    expect(r.status).toBe(400);
    expect(String(r.json.message)).toContain(field);
  });

  it("stores a valid record as sent", async () => {
    const r = await post(runsUrl, { rev: "head", ok: false, duration_ms: 12, summary: "2/3 ok" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: false, duration_ms: 12, summary: "2/3 ok" });
  });
});
