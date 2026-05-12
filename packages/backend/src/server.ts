// Backend stub HTTP server. Minimal router over node:http matching the contract in api.ts; in-memory store;
// bearer-token gate (production uses OAuth 2.1 — out of scope here); echoes the API-version header.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { API_VERSION, API_VERSION_HEADER, REVISION_ARTIFACTS, ROUTES, type RevisionArtifact, type RevisionKind } from "./api.js";
import { NotFoundError, Store } from "./store.js";

export interface BackendStubOptions {
  /** If set, `Authorization: Bearer <t>` must equal this. If unset, any non-empty bearer token passes (it's a stub). */
  token?: string;
}

interface Matched {
  route: (typeof ROUTES)[number];
  params: Record<string, string>;
}

function matchRoute(method: string, pathname: string): Matched | "method_mismatch" | null {
  const segs = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  let methodMismatch = false;
  for (const route of ROUTES) {
    const rsegs = route.path.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      const r = rsegs[i]!;
      const s = segs[i]!;
      if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(s);
      else if (r !== s) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (route.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route, params };
  }
  return methodMismatch ? "method_mismatch" : null;
}

function isArtifact(s: string): s is RevisionArtifact {
  return (REVISION_ARTIFACTS as readonly string[]).includes(s);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export function createBackendStub(opts: BackendStubOptions = {}): {
  server: Server;
  store: Store;
  /** Start listening; resolves with the bound URL (`http://127.0.0.1:<port>`). `port = 0` picks a free port. */
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
} {
  const store = new Store();

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      sendJson(res, 500, { error: "internal", message: (e as Error).message });
    });
  });

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(text + "\n");
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();

    // Version header echo / warn.
    const reqVersion = req.headers[API_VERSION_HEADER];
    res.setHeader(API_VERSION_HEADER.replace(/(^|-)([a-z])/g, (_, p, c: string) => p + c.toUpperCase()), API_VERSION);
    if (typeof reqVersion === "string" && reqVersion !== API_VERSION) {
      res.setHeader("Warning", `199 - "client API version ${reqVersion} != server ${API_VERSION}"`);
    }

    const matched = matchRoute(method, url.pathname);
    if (matched === null) return sendJson(res, 404, { error: "not_found", message: `no route for ${method} ${url.pathname}` });
    if (matched === "method_mismatch") return sendJson(res, 405, { error: "method_not_allowed", message: `${method} not allowed on ${url.pathname}` });

    // Auth gate (everything except /v1/health).
    if (url.pathname !== "/v1/health") {
      const auth = req.headers.authorization ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(auth);
      if (!m) return sendJson(res, 401, { error: "unauthorized", message: "missing Bearer token" });
      if (opts.token !== undefined && m[1] !== opts.token) {
        return sendJson(res, 401, { error: "unauthorized", message: "invalid token" });
      }
    }

    const { route, params } = matched;
    const { ws, project, rev, artifact } = params;

    try {
      switch (route.path) {
        case "/v1/health":
          return sendJson(res, 200, { ok: true, version: API_VERSION });
        case "/v1/workspaces":
          if (method === "GET") return sendJson(res, 200, store.listWorkspaces());
          return sendJson(res, 201, store.createWorkspace(reqName(await readJsonBody(req))));
        case "/v1/workspaces/:ws":
          return sendJson(res, 200, store.getWorkspace(ws!));
        case "/v1/workspaces/:ws/projects":
          if (method === "GET") return sendJson(res, 200, store.listProjects(ws!));
          return sendJson(res, 201, store.createProject(ws!, reqName(await readJsonBody(req))));
        case "/v1/workspaces/:ws/projects/:project":
          return sendJson(res, 200, store.getProject(ws!, project!));
        case "/v1/workspaces/:ws/projects/:project/revisions":
          if (method === "GET") return sendJson(res, 200, store.listRevisions(ws!, project!));
          {
            const b = (await readJsonBody(req)) as { kind?: string; author?: string } | undefined;
            const kind = b?.kind;
            if (kind !== "calibrate" && kind !== "run" && kind !== "edit") {
              return sendJson(res, 400, { error: "bad_request", message: "body requires { kind: calibrate|run|edit, author }" });
            }
            return sendJson(res, 201, store.createRevision(ws!, project!, kind as RevisionKind, String(b?.author ?? "unknown")));
          }
        case "/v1/workspaces/:ws/projects/:project/revisions/:rev":
          return sendJson(res, 200, store.getRevision(ws!, project!, rev!));
        case "/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact":
          if (!artifact || !isArtifact(artifact)) {
            return sendJson(res, 404, { error: "not_found", message: `unknown artifact "${artifact}"` });
          }
          if (method === "GET") return sendJson(res, 200, store.getArtifact(ws!, project!, rev!, artifact));
          return sendJson(res, 200, store.putArtifact(ws!, project!, rev!, artifact, await readJsonBody(req)));
        case "/v1/workspaces/:ws/projects/:project/run-history":
          if (method === "GET") return sendJson(res, 200, store.listRuns(ws!, project!));
          {
            const b = (await readJsonBody(req)) as { rev?: string; ok?: boolean; duration_ms?: number; summary?: string } | undefined;
            if (!b || typeof b.rev !== "string") return sendJson(res, 400, { error: "bad_request", message: "body requires { rev, ok, duration_ms, summary }" });
            return sendJson(res, 201, store.appendRun(ws!, project!, { rev: b.rev, ok: !!b.ok, duration_ms: Number(b.duration_ms ?? 0), summary: String(b.summary ?? "") }));
          }
        default:
          return sendJson(res, 404, { error: "not_found", message: "unrouted" });
      }
    } catch (e) {
      if (e instanceof NotFoundError) return sendJson(res, 404, { error: "not_found", message: e.message });
      if (e instanceof SyntaxError) return sendJson(res, 400, { error: "bad_request", message: `invalid JSON body: ${e.message}` });
      throw e;
    }
  }

  function reqName(body: unknown): string {
    const name = (body as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || !name.trim()) throw new SyntaxError("body requires a non-empty { name }");
    return name;
  }

  return {
    server,
    store,
    listen(port = 0): Promise<string> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          if (addr && typeof addr === "object") resolve(`http://127.0.0.1:${addr.port}`);
          else reject(new Error("failed to bind"));
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
