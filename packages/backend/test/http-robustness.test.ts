import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe("request path handling", () => {
  it("400s a malformed percent-encoding instead of failing with a 500", async () => {
    const r = await fetch(`${base}/v1/workspaces/%E0%A4%A`, { headers: h() });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(((await r.json()) as { error: string }).error).toBe("bad_request");
  });
});

describe("405 responses", () => {
  it("list the served methods in Allow", async () => {
    const del = await fetch(`${base}/v1/workspaces`, { method: "DELETE", headers: h() });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("GET, POST");

    const opt = await fetch(`${base}/v1/workspaces/w/auth-cache/r`, {
      method: "OPTIONS",
      headers: h(),
    });
    expect(opt.status).toBe(405);
    expect(opt.headers.get("allow")).toBe("DELETE, GET, PUT");
  });
});
