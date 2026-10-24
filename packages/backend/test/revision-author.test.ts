import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;
let revisionsUrl = "";

const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  const ws = (await (await post(`${base}/v1/workspaces`, { name: "w" })).json()) as { id: string };
  const proj = (await (
    await post(`${base}/v1/workspaces/${ws.id}/projects`, { name: "p" })
  ).json()) as {
    id: string;
  };
  revisionsUrl = `${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions`;
});
afterAll(async () => {
  await stub.close();
});

describe("revision author", () => {
  it("400s an author that is not a string", async () => {
    for (const author of [{ name: "x" }, 7, ["a"], true]) {
      const r = await post(revisionsUrl, { kind: "run", author });
      expect(r.status).toBe(400);
    }
    const list = (await (await fetch(revisionsUrl, { headers: h })).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  it("stores a string author and defaults a missing one to unknown", async () => {
    const named = (await (await post(revisionsUrl, { kind: "run", author: "rowin" })).json()) as {
      author: string;
    };
    expect(named.author).toBe("rowin");
    const anon = (await (await post(revisionsUrl, { kind: "run" })).json()) as { author: string };
    expect(anon.author).toBe("unknown");
  });
});
