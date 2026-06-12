// Backend HTTP server. Minimal router over node:http matching the contract in api.ts; pluggable
// store (in-memory by default, filesystem with `dataDir`); bearer-token gate accepting the CI
// token and any live OAuth-issued access token; echoes the API-version header.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  API_VERSION,
  API_VERSION_HEADER,
  BLOB_BODY_LIMIT_BYTES,
  isAuthCacheEnvelope,
  JSON_BODY_LIMIT_BYTES,
  OAUTH_CLIENT_ID,
  parseWebhookConfig,
  REVISION_ARTIFACTS,
  ROUTES,
  type RevisionArtifact,
} from "./api.js";
import { FsStore } from "./fs-store.js";
import { isLoopbackRedirectUri, OAuthError, OAuthIssuer } from "./oauth.js";
import { SpawnRunner } from "./runner.js";
import { type BackendStore, MemoryStore, NotFoundError, RevisionFinalizedError } from "./store.js";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  QueuedDispatcher,
  SIGNATURE_HEADER,
  verifyGitHubSignature,
  type RunDispatcher,
  type WebhookJob,
} from "./webhook.js";

export interface BackendStubOptions {
  /** If set, `Authorization: Bearer <t>` must equal this (or be a live OAuth access token). If unset, any non-empty bearer token passes (it's a stub). */
  token?: string;
  /** Bring your own store. Takes precedence over `dataDir`. */
  store?: BackendStore;
  /** Persist to this directory via `FsStore`. Falls back to env `DOCSX_DATA_DIR`; default is in-memory. */
  dataDir?: string;
  /** Webhook run dispatcher. Default: a `QueuedDispatcher` driving `SpawnRunner` (real engine CLI). */
  dispatcher?: RunDispatcher;
  /** Env the webhook surface reads secrets from (tests inject; default `process.env`). */
  env?: NodeJS.ProcessEnv;
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

/** First value of a possibly-multi-valued header. */
function asSingle(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SAFE_ROLE = /^[A-Za-z0-9_.-]{1,128}$/;

class PayloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds the ${limit}-byte limit`);
    this.name = "PayloadTooLargeError";
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new PayloadTooLargeError(limit);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    total += chunk.length;
    if (total > limit) throw new PayloadTooLargeError(limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(req, JSON_BODY_LIMIT_BYTES)).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function resolveStore(opts: BackendStubOptions): BackendStore {
  if (opts.store) return opts.store;
  const dataDir = opts.dataDir ?? process.env.DOCSX_DATA_DIR;
  return dataDir ? new FsStore(dataDir) : new MemoryStore();
}

export function createBackendStub(opts: BackendStubOptions = {}): {
  server: Server;
  store: BackendStore;
  /** Start listening; resolves with the bound URL (`http://127.0.0.1:<port>`). `port = 0` picks a free port. */
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
} {
  const store = resolveStore(opts);
  const oauth = new OAuthIssuer();
  const env = opts.env ?? process.env;
  const dispatcher =
    opts.dispatcher ??
    new QueuedDispatcher((job) => new SpawnRunner({ store, env }).executeRun(job).then(() => {}));

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      sendJson(res, 500, { error: "internal", message: (e as Error).message });
    });
  });

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return;
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(text + "\n");
  }

  function sendUnauthorized(res: ServerResponse, message: string): void {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    sendJson(res, 401, { error: "unauthorized", message });
  }

  /** True when the bearer value satisfies the CI-token rule (exact match, or any non-empty when unset). */
  function isCiToken(token: string): boolean {
    return opts.token !== undefined ? token === opts.token : token.length > 0;
  }

  function bearerToken(req: IncomingMessage): string | null {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    return m ? m[1]! : null;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase();

    // Version header echo / warn.
    const reqVersion = req.headers[API_VERSION_HEADER];
    res.setHeader(
      API_VERSION_HEADER.replace(/(^|-)([a-z])/g, (_, p, c: string) => p + c.toUpperCase()),
      API_VERSION,
    );
    if (typeof reqVersion === "string" && reqVersion !== API_VERSION) {
      res.setHeader("Warning", `199 - "client API version ${reqVersion} != server ${API_VERSION}"`);
    }

    const matched = matchRoute(method, url.pathname);
    if (matched === null)
      return sendJson(res, 404, {
        error: "not_found",
        message: `no route for ${method} ${url.pathname}`,
      });
    if (matched === "method_mismatch")
      return sendJson(res, 405, {
        error: "method_not_allowed",
        message: `${method} not allowed on ${url.pathname}`,
      });

    // Auth gate (everything except /v1/health, the OAuth endpoints, and the GitHub webhook —
    // the webhook is HMAC-signature-verified instead of bearer-gated).
    const noAuth =
      url.pathname === "/v1/health" ||
      url.pathname === "/v1/oauth/authorize" ||
      url.pathname === "/v1/oauth/token" ||
      url.pathname === "/v1/github/webhook";
    if (!noAuth) {
      const token = bearerToken(req);
      if (token === null) return sendUnauthorized(res, "missing Bearer token");
      if (!isCiToken(token) && !oauth.isLiveAccessToken(token)) {
        return sendUnauthorized(res, "invalid, expired, or unknown token");
      }
    }

    const { route, params } = matched;
    const { ws, project, rev, artifact, sha256, role } = params;

    try {
      switch (route.path) {
        case "/v1/health":
          return sendJson(res, 200, { ok: true, version: API_VERSION });
        case "/v1/oauth/authorize":
          return handleAuthorize(req, res, url);
        case "/v1/oauth/token":
          return await handleToken(req, res);
        case "/v1/blobs": {
          const data = await readBody(req, BLOB_BODY_LIMIT_BYTES);
          if (data.length === 0)
            return sendJson(res, 400, { error: "bad_request", message: "empty blob body" });
          return sendJson(res, 200, store.putBlob(data));
        }
        case "/v1/blobs/:sha256": {
          if (!sha256 || !SHA256_HEX.test(sha256)) {
            return sendJson(res, 404, {
              error: "not_found",
              message: "blob ids are lowercase hex sha256 digests",
            });
          }
          if (method === "HEAD") {
            const ref = store.hasBlob(sha256);
            if (!ref) {
              res.writeHead(404).end();
              return;
            }
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-length": ref.bytes,
            });
            res.end();
            return;
          }
          const data = store.getBlob(sha256);
          res.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": data.byteLength,
          });
          res.end(data);
          return;
        }
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
              return sendJson(res, 400, {
                error: "bad_request",
                message: "body requires { kind: calibrate|run|edit, author }",
              });
            }
            return sendJson(
              res,
              201,
              store.createRevision(ws!, project!, kind, String(b?.author ?? "unknown")),
            );
          }
        case "/v1/workspaces/:ws/projects/:project/revisions/:rev":
          return sendJson(res, 200, store.getRevision(ws!, project!, rev!));
        case "/v1/workspaces/:ws/projects/:project/revisions/:rev/finalize":
          return sendJson(res, 200, store.finalizeRevision(ws!, project!, rev!));
        case "/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact": {
          if (!artifact || !isArtifact(artifact)) {
            return sendJson(res, 404, {
              error: "not_found",
              message: `unknown artifact "${artifact}"`,
            });
          }
          if (method === "GET")
            return sendJson(res, 200, store.getArtifact(ws!, project!, rev!, artifact));
          const payload = await readJsonBody(req);
          if (payload === undefined) {
            return sendJson(res, 400, {
              error: "bad_request",
              message: "artifact PUT requires a JSON body",
            });
          }
          return sendJson(res, 200, store.putArtifact(ws!, project!, rev!, artifact, payload));
        }
        case "/v1/workspaces/:ws/projects/:project/run-history":
          if (method === "GET") return sendJson(res, 200, store.listRuns(ws!, project!));
          {
            const b = (await readJsonBody(req)) as
              | { rev?: string; ok?: boolean; duration_ms?: number; summary?: string }
              | undefined;
            if (!b || typeof b.rev !== "string")
              return sendJson(res, 400, {
                error: "bad_request",
                message: "body requires { rev, ok, duration_ms, summary }",
              });
            return sendJson(
              res,
              201,
              store.appendRun(ws!, project!, {
                rev: b.rev,
                ok: !!b.ok,
                duration_ms: Number(b.duration_ms ?? 0),
                summary: String(b.summary ?? ""),
              }),
            );
          }
        case "/v1/workspaces/:ws/projects/:project/webhook-config": {
          if (method === "GET") return sendJson(res, 200, store.getWebhookConfig(ws!, project!));
          const parsed = parseWebhookConfig(await readJsonBody(req));
          if (typeof parsed === "string") {
            return sendJson(res, 400, { error: "bad_request", message: parsed });
          }
          return sendJson(res, 200, store.putWebhookConfig(ws!, project!, parsed));
        }
        case "/v1/github/webhook":
          return await handleGitHubWebhook(req, res);
        case "/v1/workspaces/:ws/auth-cache/:role": {
          if (!role || !SAFE_ROLE.test(role)) {
            return sendJson(res, 400, {
              error: "bad_request",
              message: "role must match [A-Za-z0-9_.-]{1,128}",
            });
          }
          if (method === "GET") return sendJson(res, 200, store.getAuthCache(ws!, role));
          if (method === "DELETE") {
            store.deleteAuthCache(ws!, role);
            res.writeHead(204).end();
            return;
          }
          const envelope = await readJsonBody(req);
          if (!isAuthCacheEnvelope(envelope)) {
            return sendJson(res, 400, {
              error: "bad_request",
              message:
                "body must be a docsxai/auth-cache@1 envelope ({ schema, alg: aes-256-gcm, iv, ciphertext, tag, expires_at? })",
            });
          }
          store.putAuthCache(ws!, role, envelope);
          res.writeHead(204).end();
          return;
        }
        default:
          return sendJson(res, 404, { error: "not_found", message: "unrouted" });
      }
    } catch (e) {
      if (e instanceof PayloadTooLargeError) {
        req.resume(); // drain what the client is still sending so the response is read cleanly
        return sendJson(res, 413, { error: "payload_too_large", message: e.message });
      }
      if (e instanceof RevisionFinalizedError)
        return sendJson(res, 409, { error: "revision-finalized", message: e.message });
      if (e instanceof NotFoundError)
        return sendJson(res, 404, { error: "not_found", message: e.message });
      if (e instanceof SyntaxError)
        return sendJson(res, 400, {
          error: "bad_request",
          message: `invalid JSON body: ${e.message}`,
        });
      throw e;
    }
  }

  /**
   * GitHub webhook receiver. Unauthenticated route, but strictly verified: the repo named in the
   * payload must map to a configured project, and the X-Hub-Signature-256 HMAC must validate
   * against that project's secret (read from the env var the config names) before anything else
   * is trusted. Accepted deliveries are queued (202) — execution happens after the response.
   */
  async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req, JSON_BODY_LIMIT_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return sendJson(res, 400, { error: "bad_request", message: "invalid JSON payload" });
    }
    const repo = (payload as { repository?: { full_name?: unknown } }).repository?.full_name;
    if (typeof repo !== "string" || !repo) {
      return sendJson(res, 400, {
        error: "bad_request",
        message: "payload missing repository.full_name",
      });
    }
    const match = store.findWebhookProject(repo);
    if (!match) {
      return sendJson(res, 404, {
        error: "not_found",
        message: `no project is configured for repository ${repo}`,
      });
    }
    // Signature gate. A missing secret in the env fails closed (401), never open.
    const secret = env[match.config.secret_env];
    const signature = req.headers[SIGNATURE_HEADER];
    if (!secret || !verifyGitHubSignature(secret, raw, asSingle(signature))) {
      res.setHeader("WWW-Authenticate", 'Signature realm="github-webhook"');
      return sendJson(res, 401, {
        error: "unauthorized",
        message: "missing or invalid X-Hub-Signature-256",
      });
    }
    const deliveryId = asSingle(req.headers[DELIVERY_HEADER]);
    if (!deliveryId) {
      return sendJson(res, 400, {
        error: "bad_request",
        message: "missing X-GitHub-Delivery header",
      });
    }
    if (!match.config.enabled) {
      return sendJson(res, 200, { delivery_id: deliveryId, dispatched: false, reason: "disabled" });
    }
    const event = asSingle(req.headers[EVENT_HEADER]) ?? "";
    if (!(match.config.events as string[]).includes(event)) {
      return sendJson(res, 200, {
        delivery_id: deliveryId,
        dispatched: false,
        reason: "event-filtered",
        event,
      });
    }
    if (!store.rememberWebhookDelivery(deliveryId)) {
      return sendJson(res, 200, { delivery_id: deliveryId, duplicate: true, dispatched: false });
    }
    const job: WebhookJob = {
      delivery_id: deliveryId,
      event,
      workspace_id: match.workspace_id,
      project_id: match.project_id,
      repo,
      config: match.config,
      payload,
    };
    await dispatcher.dispatch(job);
    return sendJson(res, 202, {
      delivery_id: deliveryId,
      project_id: match.project_id,
      dispatched: true,
    });
  }

  function handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const q = url.searchParams;
    const bad = (message: string) => sendJson(res, 400, { error: "invalid_request", message });
    if (q.get("client_id") !== OAUTH_CLIENT_ID) {
      return bad(`unknown client_id (expected "${OAUTH_CLIENT_ID}")`);
    }
    const challenge = q.get("code_challenge");
    if (!challenge) return bad("code_challenge is required");
    if (q.get("code_challenge_method") !== "S256") {
      return bad('code_challenge_method must be "S256"');
    }
    const redirectUri = q.get("redirect_uri");
    if (!redirectUri || !isLoopbackRedirectUri(redirectUri)) {
      return bad(
        "redirect_uri must be a loopback http URI (e.g. http://127.0.0.1:<port>/callback)",
      );
    }
    // Stub-grade consent: auto-approve for callers holding the CI bearer token, or when
    // DOCSX_OAUTH_AUTO_APPROVE=1. A real interactive consent UI is hosted-deployment
    // scope (owner-gated).
    const token = bearerToken(req);
    const approved =
      (token !== null && isCiToken(token)) || process.env.DOCSX_OAUTH_AUTO_APPROVE === "1";
    if (!approved) {
      return sendJson(res, 403, {
        error: "consent_required",
        message:
          "auto-approval declined — present Authorization: Bearer <DOCSX_TOKEN> or set DOCSX_OAUTH_AUTO_APPROVE=1 (interactive consent is hosted-deployment scope)",
      });
    }
    const code = oauth.issueCode({ challenge, redirectUri });
    const location = new URL(redirectUri);
    location.searchParams.set("code", code);
    const state = q.get("state");
    if (state !== null) location.searchParams.set("state", state);
    res.writeHead(302, { location: location.toString() }).end();
  }

  async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = (await readBody(req, JSON_BODY_LIMIT_BYTES)).toString("utf8");
    const form = new URLSearchParams(raw);
    const grantType = form.get("grant_type");
    try {
      if (grantType === "authorization_code") {
        const code = form.get("code");
        const verifier = form.get("code_verifier");
        if (!code || !verifier) {
          throw new OAuthError("invalid_request", "code and code_verifier are required");
        }
        const redirectUri = form.get("redirect_uri");
        return sendJson(
          res,
          200,
          oauth.exchangeCode({
            code,
            verifier,
            ...(redirectUri !== null ? { redirectUri } : {}),
          }),
        );
      }
      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token");
        if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
        return sendJson(res, 200, oauth.refresh(refreshToken));
      }
      throw new OAuthError(
        "unsupported_grant_type",
        'grant_type must be "authorization_code" or "refresh_token"',
      );
    } catch (e) {
      if (e instanceof OAuthError) return sendJson(res, 400, { error: e.code, message: e.message });
      throw e;
    }
  }

  function reqName(body: unknown): string {
    const name = (body as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || !name.trim())
      throw new SyntaxError("body requires a non-empty { name }");
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
