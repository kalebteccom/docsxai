import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrlProblem, createBackendStub, MemoryStore, NotFoundError } from "../src/index.js";
import { FsStore } from "../src/fs-store.js";
import { SpawnRunner } from "../src/runner.js";
import type { BackendStore } from "../src/store.js";
import type { WebhookJob } from "../src/webhook.js";

const URL_A = "https://app.example.com/base";
const URL_B = "http://localhost:3000";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("appUrlProblem", () => {
  it.each([URL_A, URL_B, "http://127.0.0.1:8080/", "https://example.com"])("accepts %s", (u) => {
    expect(appUrlProblem(u)).toBeNull();
  });

  it.each([
    "",
    "not a url",
    "/relative/path",
    "example.com",
    "ftp://example.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com",
    `https://example.com/${"a".repeat(2100)}`,
    42,
    null,
    undefined,
  ])("refuses %j", (u) => {
    expect(appUrlProblem(u)).toEqual(expect.any(String));
  });
});

describe.each([
  ["MemoryStore", () => new MemoryStore()],
  [
    "FsStore",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-app-url-"));
      dirs.push(dir);
      return new FsStore(dir);
    },
  ],
])("%s project app_url", (_name, make: () => BackendStore) => {
  it("is absent by default, set on create, changed and cleared on update", () => {
    const store = make();
    const ws = store.createWorkspace("ws");
    const plain = store.createProject(ws.id, "plain");
    expect(plain).not.toHaveProperty("app_url");

    const withUrl = store.createProject(ws.id, "with", URL_A);
    expect(withUrl.app_url).toBe(URL_A);
    expect(store.getProject(ws.id, withUrl.id).app_url).toBe(URL_A);
    expect(store.listProjects(ws.id).find((p) => p.id === withUrl.id)?.app_url).toBe(URL_A);

    expect(store.setProjectAppUrl(ws.id, plain.id, URL_B).app_url).toBe(URL_B);
    expect(store.getProject(ws.id, plain.id).app_url).toBe(URL_B);
    expect(store.setProjectAppUrl(ws.id, plain.id, null)).not.toHaveProperty("app_url");
    expect(store.getProject(ws.id, plain.id)).not.toHaveProperty("app_url");
  });

  it("throws NotFoundError for an unknown project", () => {
    const store = make();
    const ws = store.createWorkspace("ws");
    expect(() => store.setProjectAppUrl(ws.id, "nope", URL_A)).toThrow(NotFoundError);
  });
});

describe("FsStore persistence", () => {
  it("keeps app_url across store instances", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-app-url-"));
    dirs.push(dir);
    const a = new FsStore(dir);
    const ws = a.createWorkspace("ws");
    const project = a.createProject(ws.id, "p", URL_A);
    expect(new FsStore(dir).getProject(ws.id, project.id).app_url).toBe(URL_A);
  });
});

describe("project app_url over HTTP", () => {
  const TOKEN = "test-token";
  let base = "";
  let stub: ReturnType<typeof createBackendStub>;
  let wsId = "";
  const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${base}${url}`, { method, headers: h, body: JSON.stringify(body) });

  beforeAll(async () => {
    stub = createBackendStub({ token: TOKEN });
    base = await stub.listen(0);
    wsId = ((await (await send("POST", "/v1/workspaces", { name: "ws" })).json()) as { id: string })
      .id;
  });
  afterAll(async () => {
    await stub.close();
  });

  it("round-trips app_url through create, get, update and clear", async () => {
    const created = await send("POST", `/v1/workspaces/${wsId}/projects`, {
      name: "p",
      app_url: URL_A,
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string; app_url?: string };
    expect(project.app_url).toBe(URL_A);

    const path_ = `/v1/workspaces/${wsId}/projects/${project.id}`;
    expect(((await (await send("GET", path_)).json()) as { app_url?: string }).app_url).toBe(URL_A);

    const updated = await send("PUT", path_, { app_url: URL_B });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { app_url?: string }).app_url).toBe(URL_B);

    const cleared = await send("PUT", path_, { app_url: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).not.toHaveProperty("app_url");
  });

  it("creates a project without app_url as before", async () => {
    const r = await send("POST", `/v1/workspaces/${wsId}/projects`, { name: "plain" });
    expect(r.status).toBe(201);
    expect(await r.json()).not.toHaveProperty("app_url");
  });

  it.each(["ftp://example.com", "not a url", "https://u:p@example.com", 5, ""])(
    "refuses an invalid app_url %j with 400 and a message",
    async (bad) => {
      const create = await send("POST", `/v1/workspaces/${wsId}/projects`, {
        name: "bad",
        app_url: bad,
      });
      expect(create.status).toBe(400);
      const body = (await create.json()) as { error: string; message: string };
      expect(body.error).toBe("bad_request");
      expect(body.message).toContain("app_url");

      const ok = (await (
        await send("POST", `/v1/workspaces/${wsId}/projects`, { name: "ok" })
      ).json()) as { id: string };
      const update = await send("PUT", `/v1/workspaces/${wsId}/projects/${ok.id}`, {
        app_url: bad,
      });
      expect(update.status).toBe(400);
      expect(((await update.json()) as { message: string }).message).toContain("app_url");
    },
  );

  it("refuses an update without an app_url key", async () => {
    const p = (await (
      await send("POST", `/v1/workspaces/${wsId}/projects`, { name: "k" })
    ).json()) as { id: string };
    const r = await send("PUT", `/v1/workspaces/${wsId}/projects/${p.id}`, {});
    expect(r.status).toBe(400);
  });

  it("404s an update to an unknown project", async () => {
    const r = await send("PUT", `/v1/workspaces/${wsId}/projects/nope`, { app_url: URL_A });
    expect(r.status).toBe(404);
  });
});

describe("SpawnRunner.materializeWorkspace app_url", () => {
  function jobFor(store: MemoryStore, appUrl?: string) {
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "site", appUrl);
    const rev = store.createRevision(ws.id, project.id, "run", "ci");
    const job = {
      delivery_id: "d",
      event: "push",
      workspace_id: ws.id,
      project_id: project.id,
      repo: "o/r",
      config: { workspace_rev: rev.id },
      payload: {},
    } as unknown as WebhookJob;
    return { ws, project, job };
  }

  it("writes the project's app_url into .docsxai.json", () => {
    const store = new MemoryStore();
    const { job } = jobFor(store, URL_A);
    const dir = new SpawnRunner({ store }).materializeWorkspace(job);
    dirs.push(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".docsxai.json"), "utf8"))).toMatchObject({
      schema: "docsxai/workspace@1",
      app_url: URL_A,
    });
  });

  it("follows an update to the project's app_url", () => {
    const store = new MemoryStore();
    const { ws, project, job } = jobFor(store, URL_A);
    store.setProjectAppUrl(ws.id, project.id, URL_B);
    const dir = new SpawnRunner({ store }).materializeWorkspace(job);
    dirs.push(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".docsxai.json"), "utf8")).app_url).toBe(
      URL_B,
    );
  });

  it("leaves app_url out when the project has none", () => {
    const store = new MemoryStore();
    const { job } = jobFor(store);
    const dir = new SpawnRunner({ store }).materializeWorkspace(job);
    dirs.push(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".docsxai.json"), "utf8"))).not.toHaveProperty(
      "app_url",
    );
  });
});
