// Streamable HTTP transport over a real loopback socket on an ephemeral port: auth, Host / Origin
// rejection, size and session limits, idle expiry, and an SDK client listing the same tools the
// stdio registry registers. Raw requests go through node:http so the Host header can be set.

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "../src/index.js";
import {
  startHttpServer,
  type HttpServerOptions,
  type RunningHttpServer,
} from "../src/http-server.js";

const TOKEN = "http-test-token-".padEnd(48, "z");

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "http-test", version: "0.0.1" },
  },
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

interface Send {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Written one by one with no Content-Length; pair with a chunked Transfer-Encoding header. */
  chunks?: string[];
  /** Skip the Authorization header entirely. */
  noAuth?: boolean;
}

let running: RunningHttpServer | undefined;
const ROOT = realpathSync(mkdtempSync(path.join(tmpdir(), "docsxai-mcp-http-")));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(opts: Partial<HttpServerOptions> = {}): Promise<RunningHttpServer> {
  running = await startHttpServer({
    token: TOKEN,
    host: "127.0.0.1",
    port: 0,
    workspaceRoot: ROOT,
    ...opts,
  });
  return running;
}

function send(server: RunningHttpServer, opts: Send = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = opts.body;
    const req = request(
      {
        host: server.host,
        port: server.port,
        method: opts.method ?? "POST",
        path: opts.path ?? "/mcp",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(opts.noAuth ? {} : { Authorization: `Bearer ${TOKEN}` }),
          ...(body === undefined ? {} : { "Content-Length": String(Buffer.byteLength(body)) }),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    for (const chunk of opts.chunks ?? []) req.write(chunk);
    req.end(body);
  });
}

const initialize = (server: RunningHttpServer, extra: Send = {}): Promise<Reply> =>
  send(server, { body: INITIALIZE, ...extra });

describe("bearer token", () => {
  it("rejects a request with no Authorization header", async () => {
    const server = await start();
    const res = await initialize(server, { noAuth: true });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(JSON.parse(res.text)).toEqual({ error: "unauthorized" });
  });

  it("rejects a wrong token and another scheme with the same bare body", async () => {
    const server = await start();
    for (const authorization of [
      `Bearer ${TOKEN}x`,
      `Bearer ${"w".repeat(48)}`,
      `Basic ${TOKEN}`,
      TOKEN,
    ]) {
      const res = await initialize(server, { headers: { Authorization: authorization } });
      expect(res.status, authorization).toBe(401);
      expect(res.text).toBe('{"error":"unauthorized"}');
      expect(res.text).not.toContain(TOKEN);
    }
    expect(server.sessionCount()).toBe(0);
  });

  it("accepts the right token and opens a session", async () => {
    const server = await start();
    const res = await initialize(server);
    expect(res.status).toBe(200);
    expect(res.headers["mcp-session-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.text).toContain("docsxai-mcp");
    expect(server.sessionCount()).toBe(1);
  });

  it("checks the token before revealing which paths exist", async () => {
    const server = await start();
    expect((await send(server, { path: "/other", noAuth: true })).status).toBe(401);
    expect((await send(server, { path: "/other" })).status).toBe(404);
  });
});

describe("startup refusals", () => {
  it("refuses a token shorter than 32 characters", async () => {
    await expect(startHttpServer({ token: "short", port: 0, workspaceRoot: ROOT })).rejects.toThrow(
      /at least 32/,
    );
  });

  it("refuses a non-loopback host without --allow-remote", async () => {
    await expect(
      startHttpServer({ token: TOKEN, host: "0.0.0.0", port: 0, workspaceRoot: ROOT }),
    ).rejects.toThrow(/--allow-remote/);
  });

  it("refuses a wildcard allowed host", async () => {
    await expect(
      startHttpServer({
        token: TOKEN,
        port: 0,
        workspaceRoot: ROOT,
        allowedHosts: ["*.example.com"],
      }),
    ).rejects.toThrow(/no wildcards/);
  });

  it("refuses to start without a workspace root, a relative one or a missing one", async () => {
    const base = { token: TOKEN, port: 0 };
    await expect(startHttpServer({ ...base, workspaceRoot: "" })).rejects.toThrow(
      /--workspace-root/,
    );
    await expect(startHttpServer({ ...base, workspaceRoot: "relative/dir" })).rejects.toThrow(
      /absolute/,
    );
    await expect(
      startHttpServer({ ...base, workspaceRoot: path.join(ROOT, "does-not-exist") }),
    ).rejects.toThrow(/existing directory/);
  });

  it("refuses a default workspace outside the root", async () => {
    await expect(
      startHttpServer({ token: TOKEN, port: 0, workspaceRoot: ROOT, defaultWorkspace: tmpdir() }),
    ).rejects.toThrow(/outside/);
  });

  it("binds the loopback interface by default", async () => {
    const server = await start();
    expect(server.host).toBe("127.0.0.1");
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`);
  });
});

describe("Host and Origin", () => {
  it("rejects a foreign Host header even with a valid token", async () => {
    const server = await start();
    const res = await initialize(server, { headers: { Host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(res.text).toBe('{"error":"forbidden"}');
    expect(server.sessionCount()).toBe(0);
  });

  it("rejects a malformed Host that only starts like a loopback name", async () => {
    const server = await start();
    for (const host of ["127.0.0.1:80@evil.example", "localhost@evil.example", "localhost:99999"]) {
      const res = await initialize(server, { headers: { Host: host } });
      expect(res.status, host).toBe(403);
    }
  });

  it("rejects a foreign Origin, including the opaque null origin", async () => {
    const server = await start();
    for (const origin of ["https://evil.example", "null", "http://localhost.evil.example"]) {
      const res = await initialize(server, { headers: { Origin: origin } });
      expect(res.status, origin).toBe(403);
    }
  });

  it("rejects a loopback Origin on another port unless it is an --allowed-origin", async () => {
    const server = await start();
    const other = await initialize(server, { headers: { Origin: "http://localhost:5173" } });
    expect(other.status).toBe(403);
    await running?.close();
    const allowed = await start({ allowedOrigins: ["http://localhost:5173"] });
    const ok = await initialize(allowed, { headers: { Origin: "http://localhost:5173" } });
    expect(ok.status).toBe(200);
  });

  it("answers 403 before 401, so a rebinding page learns nothing about auth", async () => {
    const server = await start();
    const res = await initialize(server, { noAuth: true, headers: { Host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("accepts an Origin on the bound port and a configured --allowed-host", async () => {
    const server = await start({
      allowedHosts: ["docs.internal.example"],
      allowedOrigins: ["https://docs.internal.example"],
    });
    const sameOrigin = await initialize(server, {
      headers: { Origin: `http://localhost:${server.port}` },
    });
    expect(sameOrigin.status).toBe(200);
    const named = await initialize(server, {
      headers: {
        Host: "docs.internal.example:8443",
        Origin: "https://docs.internal.example",
      },
    });
    expect(named.status).toBe(200);
  });
});

describe("routing", () => {
  it("serves only /mcp and only GET, POST and DELETE", async () => {
    const server = await start();
    expect((await send(server, { path: "/", body: INITIALIZE })).status).toBe(404);
    const put = await send(server, { method: "PUT", body: INITIALIZE });
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, POST, DELETE");
  });

  it("answers an unknown session id with 404 and a session-less non-initialize with 400", async () => {
    const server = await start();
    const unknown = await send(server, {
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      headers: { "Mcp-Session-Id": "00000000-0000-0000-0000-000000000000" },
    });
    expect(unknown.status).toBe(404);
    const bare = await send(server, {
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(bare.status).toBe(400);
    expect(bare.text).toBe('{"error":"bad_request"}');
  });

  it("answers malformed JSON with 400", async () => {
    const server = await start();
    expect((await send(server, { body: "{not json" })).status).toBe(400);
  });

  it("closes a session on DELETE", async () => {
    const server = await start();
    const init = await initialize(server);
    const id = String(init.headers["mcp-session-id"]);
    expect(server.sessionCount()).toBe(1);
    const del = await send(server, { method: "DELETE", headers: { "Mcp-Session-Id": id } });
    expect(del.status).toBe(200);
    expect(server.sessionCount()).toBe(0);
  });
});

describe("limits", () => {
  it("answers 413 for a declared body over the cap and does not open a session", async () => {
    const server = await start({ maxBodyBytes: 512 });
    const padded = JSON.stringify({ ...JSON.parse(INITIALIZE), pad: "p".repeat(2048) });
    const res = await send(server, { body: padded });
    expect(res.status).toBe(413);
    expect(res.text).toBe('{"error":"payload_too_large"}');
    expect(server.sessionCount()).toBe(0);
  });

  it("answers 413 for a chunked body that grows past the cap", async () => {
    const server = await start({ maxBodyBytes: 512 });
    const res = await send(server, {
      chunks: ['{"pad":"', "p".repeat(2048), '"}'],
      headers: { "Transfer-Encoding": "chunked" },
    });
    expect(res.status).toBe(413);
  });

  it("answers 429 once the session cap is reached and keeps the first session", async () => {
    const server = await start({ maxSessions: 1 });
    expect((await initialize(server)).status).toBe(200);
    const second = await initialize(server);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("5");
    expect(second.text).toBe('{"error":"too_many_sessions"}');
    expect(server.sessionCount()).toBe(1);
  });

  it("closes a session that stays idle past the timeout", async () => {
    const server = await start({ idleTimeoutMs: 100 });
    await initialize(server);
    expect(server.sessionCount()).toBe(1);
    const deadline = Date.now() + 5000;
    while (server.sessionCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(server.sessionCount()).toBe(0);
  });
});

describe("SDK client", () => {
  it("lists the same tools as the stdio registry", async () => {
    const server = await start();
    const client = new Client({ name: "http-client-test", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOL_DEFINITIONS.map((d) => d.name).sort());
      expect(server.sessionCount()).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("cannot connect without the token", async () => {
    const server = await start();
    const client = new Client({ name: "http-client-test", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    await expect(client.connect(transport)).rejects.toThrow();
    expect(server.sessionCount()).toBe(0);
    await client.close().catch(() => undefined);
  });
});

describe("workspace confinement over the wire", () => {
  async function connected(server: RunningHttpServer): Promise<Client> {
    const client = new Client({ name: "http-confine-test", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0]!.text) as { ok: boolean; error?: string; [k: string]: unknown };
  }

  it("refuses a workspace argument outside the root, by absolute path and by ..", async () => {
    const server = await start();
    const client = await connected(server);
    try {
      for (const workspace of [tmpdir(), "/", "..", path.join(ROOT, "..")]) {
        const r = await call(client, "list_flows", { workspace });
        expect(r.ok, workspace).toBe(false);
        expect(r.error, workspace).toMatch(/outside the server's workspace root/);
        expect(r.error, workspace).not.toContain(tmpdir());
      }
    } finally {
      await client.close();
    }
  });

  it("scaffolds inside the root, and refuses init_workspace and zip_pack paths outside it", async () => {
    const server = await start();
    const client = await connected(server);
    try {
      const made = await call(client, "init_workspace", { dir: "confined-ws" });
      expect(made.ok).toBe(true);
      expect(made["dir"]).toBe(path.join(ROOT, "confined-ws"));

      const escaped = await call(client, "init_workspace", { dir: path.join(tmpdir(), "escape") });
      expect(escaped.ok).toBe(false);
      expect(escaped.error).toMatch(/outside/);

      const zipped = await call(client, "zip_pack", {
        workspace: "confined-ws",
        out: path.join(tmpdir(), "escape.zip"),
      });
      expect(zipped.ok).toBe(false);
      expect(zipped.error).toMatch(/outside/);
    } finally {
      await client.close();
    }
  });
});
