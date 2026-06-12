import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOB_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES } from "../src/api.js";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;

const h = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  ...extra,
});

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
});

describe("content-addressed blobs", () => {
  const data = Buffer.from("screenshot-bytes-0123456789");
  const sha = createHash("sha256").update(data).digest("hex");

  it("requires auth", async () => {
    expect((await fetch(`${base}/v1/blobs`, { method: "POST", body: data })).status).toBe(401);
  });

  it("stores a blob and returns its sha256 + byte count (idempotent)", async () => {
    const r1 = await fetch(`${base}/v1/blobs`, { method: "POST", headers: h(), body: data });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ sha256: sha, bytes: data.byteLength });

    const r2 = await fetch(`${base}/v1/blobs`, { method: "POST", headers: h(), body: data });
    expect(await r2.json()).toEqual({ sha256: sha, bytes: data.byteLength });
  });

  it("HEAD-probes existence with Content-Length; 404s unknowns", async () => {
    const hit = await fetch(`${base}/v1/blobs/${sha}`, { method: "HEAD", headers: h() });
    expect(hit.status).toBe(200);
    expect(hit.headers.get("content-length")).toBe(String(data.byteLength));

    const miss = await fetch(`${base}/v1/blobs/${"0".repeat(64)}`, {
      method: "HEAD",
      headers: h(),
    });
    expect(miss.status).toBe(404);
  });

  it("GET returns the exact bytes as application/octet-stream", async () => {
    const r = await fetch(`${base}/v1/blobs/${sha}`, { headers: h() });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(data);
  });

  it("404s a GET for unknown or malformed blob ids", async () => {
    expect((await fetch(`${base}/v1/blobs/${"f".repeat(64)}`, { headers: h() })).status).toBe(404);
    expect((await fetch(`${base}/v1/blobs/not-a-sha`, { headers: h() })).status).toBe(404);
    expect((await fetch(`${base}/v1/blobs/${"F".repeat(64)}`, { headers: h() })).status).toBe(404);
  });

  it("400s an empty blob body", async () => {
    const r = await fetch(`${base}/v1/blobs`, { method: "POST", headers: h() });
    expect(r.status).toBe(400);
  });

  it("413s a blob over the 25 MB limit", async () => {
    const big = Buffer.alloc(BLOB_BODY_LIMIT_BYTES + 1);
    const r = await fetch(`${base}/v1/blobs`, { method: "POST", headers: h(), body: big });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe("payload_too_large");
  });
});

describe("JSON body limit", () => {
  it("413s a JSON body over the 10 MB limit", async () => {
    const r = await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h({ "content-type": "application/json" }),
      body: JSON.stringify({ name: "x".repeat(JSON_BODY_LIMIT_BYTES + 16) }),
    });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe("payload_too_large");
  });

  it("accepts a JSON body under the limit on the same connection semantics", async () => {
    const r = await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h({ "content-type": "application/json" }),
      body: JSON.stringify({ name: "small" }),
    });
    expect(r.status).toBe(201);
  });
});
