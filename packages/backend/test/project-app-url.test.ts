import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appUrlProblem,
  createBackendStub,
  DENY_PRIVATE_APP_URL_ENV,
  denyPrivateAppUrl,
  MemoryStore,
  NotFoundError,
} from "../src/index.js";
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

const ALWAYS_REFUSED = [
  "http://169.254.169.254/latest/meta-data/",
  "https://169.254.0.1",
  "http://169.254.255.255:8080/x",
  // The same address as a decimal, hex, octal and mixed-radix IPv4 host.
  "http://2852039166/",
  "http://0xA9FEA9FE/",
  "http://0xa9.0xfe.0xa9.0xfe/",
  "http://0251.0376.0251.0376/",
  "http://169.254.43518/",
  "http://169.254.169.254./",
  // IPv4-mapped, NAT64 and IPv4-compatible IPv6 forms.
  "http://[::ffff:169.254.169.254]/",
  "http://[::ffff:a9fe:a9fe]/",
  "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
  "http://[64:ff9b::a9fe:a9fe]/",
  "http://[::a9fe:a9fe]/",
  // IPv6 link-local and the AWS IPv6 metadata address.
  "http://[fe80::1]/",
  "http://[febf::1]/",
  "http://[FE80::abcd]:3000/",
  "http://[fd00:ec2::254]/",
  "http://[fd00:ec2:0:0:0:0:0:254]/",
  // IPv6 forms that embed an IPv4 address: 6to4, Teredo (server, and the inverted client) and the
  // local-use NAT64 prefix.
  "http://[2002:a9fe:a9fe::1]/",
  "http://[2002:a9fe:a9fe:1:2:3:4:5]/",
  "http://[2001:0:a9fe:a9fe::1]/",
  "http://[2001:0:4136:e378:8000:63bf:5601:5601]/",
  "http://[64:ff9b:1::a9fe:a9fe]/",
  // Other clouds.
  "http://168.63.129.16/",
  "http://168.63.129.16:80/machine?comp=goalstate",
  "http://100.100.100.200/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://metadata.google.internal./",
  "http://METADATA.Google.Internal/",
  "https://instance-data/latest",
  "http://instance-data./",
];

const PRIVATE_REFUSED = [
  "http://localhost:3000",
  "http://localhost./",
  "http://localhost.localdomain/",
  "http://LOCALHOST.LOCALDOMAIN./",
  "http://ip6-localhost/",
  "http://ip6-loopback/",
  "http://app.localhost/",
  "http://127.0.0.1:8080",
  "http://127.1/",
  "http://2130706433/",
  "http://0x7f.1/",
  "http://0.0.0.0/",
  "http://10.1.2.3/",
  "http://172.16.0.1/",
  "http://172.31.255.255/",
  "http://192.168.0.1/",
  "http://100.64.0.1/",
  "http://[::1]:3000/",
  "http://[::]/",
  "http://[fc00::1]/",
  "http://[fd12:3456::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:a00:1]/",
  "http://[fec0::1]/",
  "http://[feff::1]/",
  "http://[2002:a00:1::1]/",
  "http://[2002:7f00:1::1]/",
  "http://[2001:0:a00:1::1]/",
  "http://[64:ff9b:1::1]/",
  "http://[64:ff9b:1:2:3:4:808:808]/",
];

const ALWAYS_ALLOWED = [
  "https://example.com/app",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://10.0.0.5/",
  "http://192.168.1.2/",
  "http://172.16.5.5/",
  "http://[::1]:3000/",
  "http://[fc00::1]/",
  "http://169.253.1.1/",
  "http://169.255.1.1/",
  "http://100.100.100.201/",
  "http://100.100.101.200/",
  "http://[2001:db8::1]/",
  "http://[::ffff:8.8.8.8]/",
  "http://[fec0::1]/",
  "http://[fd00:ec2::255]/",
  "http://168.63.129.17/",
  "http://168.63.128.16/",
  "http://[2002:808:808::1]/",
  "http://[2001:0:4136:e378:8000:63bf:f7f7:f7f7]/",
  "https://metadata.google.internal.example.com/",
  "https://instance-data.example.com/",
  "https://notmetadata.google.internal/",
];

const PUBLIC_ONLY = [
  "https://example.com",
  "http://8.8.8.8/",
  "http://172.15.0.1/",
  "http://172.32.0.1/",
  "http://192.169.0.1/",
  "http://100.63.0.1/",
  "http://100.128.0.1/",
  "http://[2001:db8::1]/",
  "http://[::ffff:8.8.8.8]/",
  "http://[2002:808:808::1]/",
  "http://[2001:0:4136:e378:8000:63bf:f7f7:f7f7]/",
  "http://168.63.129.17/",
];

describe("appUrlProblem: link-local and cloud-metadata hosts", () => {
  it.each(ALWAYS_REFUSED)("refuses %s by default and under denyPrivate", (u) => {
    expect(appUrlProblem(u)).toMatch(/link-local or cloud-metadata/);
    expect(appUrlProblem(u, { denyPrivate: true })).toMatch(/must not point at a/);
  });

  it.each(ALWAYS_ALLOWED)("allows %s by default", (u) => {
    expect(appUrlProblem(u)).toBeNull();
  });
});

describe("appUrlProblem: denyPrivate", () => {
  it.each(PRIVATE_REFUSED)("refuses %s under denyPrivate only", (u) => {
    expect(appUrlProblem(u)).toBeNull();
    expect(appUrlProblem(u, { denyPrivate: true })).toMatch(/loopback or private-network/);
  });

  it.each(PUBLIC_ONLY)("still allows %s under denyPrivate", (u) => {
    expect(appUrlProblem(u, { denyPrivate: true })).toBeNull();
  });

  it("reads the switch from DOCSX_BACKEND_DENY_PRIVATE_APP_URL as 1, true or yes in any case", () => {
    expect(DENY_PRIVATE_APP_URL_ENV).toBe("DOCSX_BACKEND_DENY_PRIVATE_APP_URL");
    for (const on of ["1", "true", "TRUE", "True", "yes", "Yes", "YES", " 1 "]) {
      expect(denyPrivateAppUrl({ [DENY_PRIVATE_APP_URL_ENV]: on })).toBe(true);
    }
    for (const off of ["0", "false", "no", "", "2", "on", "y", "tru", "1 1"]) {
      expect(denyPrivateAppUrl({ [DENY_PRIVATE_APP_URL_ENV]: off })).toBe(false);
    }
    expect(denyPrivateAppUrl({})).toBe(false);
  });
});

describe("project app_url host rules over HTTP", () => {
  const TOKEN = "test-token";
  const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  async function withStub(
    env: NodeJS.ProcessEnv,
    run: (
      send: (method: string, url: string, body?: unknown) => Promise<Response>,
    ) => Promise<void>,
  ): Promise<void> {
    const stub = createBackendStub({ token: TOKEN, env });
    const base = await stub.listen(0);
    try {
      await run((method, url, body) =>
        fetch(`${base}${url}`, { method, headers: h, body: JSON.stringify(body) }),
      );
    } finally {
      await stub.close();
    }
  }

  async function projectFor(send: (m: string, u: string, b?: unknown) => Promise<Response>) {
    const ws = (await (await send("POST", "/v1/workspaces", { name: "ws" })).json()) as {
      id: string;
    };
    const project = (await (
      await send("POST", `/v1/workspaces/${ws.id}/projects`, { name: "p" })
    ).json()) as { id: string };
    return {
      projects: `/v1/workspaces/${ws.id}/projects`,
      one: `/v1/workspaces/${ws.id}/projects/${project.id}`,
    };
  }

  it("refuses a metadata address on create and update with the default environment", async () => {
    await withStub({}, async (send) => {
      const { projects, one } = await projectFor(send);
      for (const bad of [
        "http://169.254.169.254/latest",
        "http://2852039166/",
        "http://[fe80::1]/",
      ]) {
        const create = await send("POST", projects, { name: "x", app_url: bad });
        expect(create.status).toBe(400);
        expect(((await create.json()) as { message: string }).message).toContain("app_url");
        expect((await send("PUT", one, { app_url: bad })).status).toBe(400);
      }
      expect((await send("PUT", one, { app_url: "http://localhost:3000" })).status).toBe(200);
    });
  });

  it("refuses loopback and private hosts too when the deployment asks for it", async () => {
    await withStub({ [DENY_PRIVATE_APP_URL_ENV]: "1" }, async (send) => {
      const { projects, one } = await projectFor(send);
      for (const bad of ["http://localhost:3000", "http://10.0.0.5/", "http://[::1]/"]) {
        expect((await send("POST", projects, { name: "x", app_url: bad })).status).toBe(400);
        expect((await send("PUT", one, { app_url: bad })).status).toBe(400);
      }
      expect((await send("PUT", one, { app_url: "https://app.example.com" })).status).toBe(200);
    });
  });
});

describe("SpawnRunner.materializeWorkspace host rules", () => {
  function setup(appUrl: string) {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    // Stored directly, as a record written before the check existed or by another store would be.
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
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-app-url-root-"));
    dirs.push(workRoot);
    return { store, job, workRoot };
  }

  it("refuses a stored metadata address and leaves no workspace behind", () => {
    const { store, job, workRoot } = setup("http://169.254.169.254/");
    const runner = new SpawnRunner({ store, workRoot, env: {} });
    expect(() => runner.materializeWorkspace(job)).toThrow(/link-local or cloud-metadata/);
    expect(fs.readdirSync(workRoot)).toEqual([]);
  });

  it("refuses a stored private address only when the environment asks for it", () => {
    const { store, job, workRoot } = setup("http://10.0.0.5/");
    const lax = new SpawnRunner({ store, workRoot, env: {} }).materializeWorkspace(job);
    dirs.push(lax);
    const config = JSON.parse(fs.readFileSync(path.join(lax, ".docsxai.json"), "utf8")) as {
      app_url: string;
    };
    expect(config.app_url).toBe("http://10.0.0.5/");
    const strict = new SpawnRunner({ store, workRoot, env: { [DENY_PRIVATE_APP_URL_ENV]: "1" } });
    expect(() => strict.materializeWorkspace(job)).toThrow(/loopback or private-network/);
  });
});
