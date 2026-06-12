import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let wsId = "";
let stub: ReturnType<typeof createBackendStub>;

const h = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
  ...extra,
});

const VALID_ENVELOPE = {
  schema: "site-docs/auth-cache@1",
  alg: "aes-256-gcm",
  iv: "MTIzNDU2Nzg5MGFi",
  ciphertext: "b3BhcXVlLWJ5dGVz",
  tag: "dGFnLXRhZy10YWctdGFn",
  expires_at: 1999999999999,
};

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  const ws = await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "cache-ws" }),
    })
  ).json();
  wsId = (ws as { id: string }).id;
});
afterAll(async () => {
  await stub.close();
});

const cacheUrl = (role: string, ws = wsId) => `${base}/v1/workspaces/${ws}/auth-cache/${role}`;

describe("auth-cache relay", () => {
  it("requires auth", async () => {
    expect((await fetch(cacheUrl("editor"))).status).toBe(401);
  });

  it("PUT stores a valid envelope (204) and GET round-trips it untouched", async () => {
    const put = await fetch(cacheUrl("editor"), {
      method: "PUT",
      headers: h(),
      body: JSON.stringify(VALID_ENVELOPE),
    });
    expect(put.status).toBe(204);

    const got = await fetch(cacheUrl("editor"), { headers: h() });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(VALID_ENVELOPE);
  });

  it("rejects malformed envelopes with 400", async () => {
    const malformed: unknown[] = [
      {},
      { ...VALID_ENVELOPE, schema: "site-docs/auth-cache@99" },
      { ...VALID_ENVELOPE, alg: "aes-128-cbc" },
      { ...VALID_ENVELOPE, iv: "" },
      { ...VALID_ENVELOPE, tag: undefined },
      { ...VALID_ENVELOPE, ciphertext: 12345 },
      { ...VALID_ENVELOPE, expires_at: "soon" },
      "just-a-string",
    ];
    for (const body of malformed) {
      const r = await fetch(cacheUrl("editor"), {
        method: "PUT",
        headers: h(),
        body: JSON.stringify(body),
      });
      expect(r.status).toBe(400);
    }
    // The previously stored envelope is untouched by the rejected writes.
    expect(await (await fetch(cacheUrl("editor"), { headers: h() })).json()).toEqual(
      VALID_ENVELOPE,
    );
  });

  it("rejects unsafe role names with 400", async () => {
    for (const role of ["..%2Fescape", "a%20b"]) {
      const r = await fetch(cacheUrl(role), {
        method: "PUT",
        headers: h(),
        body: JSON.stringify(VALID_ENVELOPE),
      });
      expect(r.status).toBe(400);
    }
    // A raw "%2e%2e" path segment never reaches the role param: WHATWG URL parsing on the server
    // resolves dot segments before routing, so the request lands on the parent route (PUT there
    // is not allowed → 405). Sent via node:http because fetch would normalize client-side too.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      const req = http.request(
        {
          host: u.hostname,
          port: u.port,
          method: "PUT",
          path: `/v1/workspaces/${wsId}/auth-cache/%2e%2e`,
          headers: h(),
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(VALID_ENVELOPE));
    });
    expect(status).toBe(405);
  });

  it("404s a GET for a role with no entry and for an unknown workspace", async () => {
    expect((await fetch(cacheUrl("nobody"), { headers: h() })).status).toBe(404);
    expect(
      (await fetch(cacheUrl("editor", "00000000-0000-0000-0000-000000000000"), { headers: h() }))
        .status,
    ).toBe(404);
  });

  it("DELETE removes the entry (204) and is idempotent", async () => {
    expect((await fetch(cacheUrl("editor"), { method: "DELETE", headers: h() })).status).toBe(204);
    expect((await fetch(cacheUrl("editor"), { headers: h() })).status).toBe(404);
    expect((await fetch(cacheUrl("editor"), { method: "DELETE", headers: h() })).status).toBe(204);
  });
});
