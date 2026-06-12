// HTTP client for `@kalebtec/docsxai-backend`. Used by `site-docs push` / `pull` / `login` / `run`.
//
// The contract types are *redeclared* here (not imported from the backend package) so the engine
// stays decoupled at the package level — there's no runtime nor build-time dep on the backend.
// Drift is caught by the round-trip integration test that spins up a real stub. The shapes mirror
// the backend's `api.ts` exactly; if you change one, update the other and the test will tell you.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { type RevisionKind } from "./doc-pack.js";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

export const API_VERSION = "1" as const;
export const API_VERSION_HEADER = "site-docs-api-version";

export type RevisionArtifact = "flows" | "annotations" | "screenshots" | "style" | "locators";

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  head_revision_id: string | null;
}

export interface Revision {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  kind: RevisionKind;
  author: string;
  created_at: string;
  artifacts: RevisionArtifact[];
  /** True once finalized — artifact PUTs are rejected with 409 from then on. */
  finalized: boolean;
}

export interface RunRecord {
  id: string;
  project_id: string;
  revision_id: string;
  ok: boolean;
  duration_ms: number;
  summary: string;
  created_at: string;
}

/** Reference to a content-addressed blob stored on the backend. */
export interface BlobRef {
  sha256: string;
  bytes: number;
}

export class BackendClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BackendClientError";
  }
}

export interface BackendClientOptions {
  baseUrl: string;
  /** Bearer token. Reads from `SITE_DOCS_TOKEN` env if omitted. */
  token?: string;
  /** Override the HTTP fetch (for tests). Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: BackendClientOptions) {
    if (!opts.baseUrl) throw new BackendClientError("baseUrl is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token ?? process.env.SITE_DOCS_TOKEN ?? "";
    this.doFetch = opts.fetch ?? globalThis.fetch;
    if (!this.token) {
      throw new BackendClientError(
        "no bearer token — set SITE_DOCS_TOKEN env var or pass `token`. Run `site-docs login` to validate.",
      );
    }
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      [API_VERSION_HEADER]: API_VERSION,
      "content-type": "application/json",
      ...(extra ?? {}),
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.doFetch(url, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      throw new BackendClientError(
        `${method} ${path} → ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        parsed,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<{ ok: boolean }> {
    // /v1/health is the only no-auth endpoint; bypass the bearer here in case caller's token is bad.
    return this.doFetch(`${this.baseUrl}/v1/health`).then((r) => {
      if (!r.ok) throw new BackendClientError(`health → ${r.status}`);
      return r.json() as Promise<{ ok: boolean }>;
    });
  }

  // --- workspaces ---
  listWorkspaces(): Promise<Workspace[]> {
    return this.req("GET", "/v1/workspaces");
  }
  createWorkspace(name: string): Promise<Workspace> {
    return this.req("POST", "/v1/workspaces", { name });
  }
  getWorkspace(id: string): Promise<Workspace> {
    return this.req("GET", `/v1/workspaces/${encodeURIComponent(id)}`);
  }

  // --- projects ---
  listProjects(wsId: string): Promise<Project[]> {
    return this.req("GET", `/v1/workspaces/${encodeURIComponent(wsId)}/projects`);
  }
  createProject(wsId: string, name: string): Promise<Project> {
    return this.req("POST", `/v1/workspaces/${encodeURIComponent(wsId)}/projects`, { name });
  }
  getProject(wsId: string, projectId: string): Promise<Project> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}`,
    );
  }

  // --- revisions ---
  listRevisions(wsId: string, projectId: string): Promise<Revision[]> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions`,
    );
  }
  createRevision(
    wsId: string,
    projectId: string,
    body: { kind: RevisionKind; author: string },
  ): Promise<Revision> {
    return this.req(
      "POST",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions`,
      body,
    );
  }
  getRevision(wsId: string, projectId: string, rev: string): Promise<Revision> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(rev)}`,
    );
  }
  /** Finalize a revision (idempotent). Artifact PUTs afterwards are rejected with 409. */
  finalizeRevision(wsId: string, projectId: string, rev: string): Promise<Revision> {
    return this.req(
      "POST",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(rev)}/finalize`,
    );
  }
  /** PUT an artifact's payload on a revision. The backend treats the payload as opaque JSON. */
  putArtifact(
    wsId: string,
    projectId: string,
    rev: string,
    artifact: RevisionArtifact,
    payload: unknown,
  ): Promise<void> {
    return this.req(
      "PUT",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(rev)}/${artifact}`,
      payload,
    );
  }
  getArtifact<T = unknown>(
    wsId: string,
    projectId: string,
    rev: string,
    artifact: RevisionArtifact,
  ): Promise<T> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(rev)}/${artifact}`,
    );
  }

  // --- run history ---
  appendRun(
    wsId: string,
    projectId: string,
    rec: { rev: string; ok: boolean; duration_ms: number; summary: string },
  ): Promise<RunRecord> {
    return this.req(
      "POST",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/run-history`,
      rec,
    );
  }
  listRuns(wsId: string, projectId: string): Promise<RunRecord[]> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/run-history`,
    );
  }

  // --- content-addressed blobs ---
  /** Upload raw bytes; the backend stores them under their sha256. Idempotent. */
  async putBlob(data: Uint8Array): Promise<BlobRef> {
    const res = await this.doFetch(`${this.baseUrl}/v1/blobs`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/octet-stream" }),
      body: data,
    });
    if (!res.ok) {
      throw new BackendClientError(`POST /v1/blobs → ${res.status}`, res.status);
    }
    return (await res.json()) as BlobRef;
  }
  /** HEAD-probe a blob — true when the backend already has these bytes. */
  async hasBlob(sha256: string): Promise<boolean> {
    const res = await this.doFetch(`${this.baseUrl}/v1/blobs/${encodeURIComponent(sha256)}`, {
      method: "HEAD",
      headers: this.headers(),
    });
    if (res.status === 404) return false;
    if (!res.ok)
      throw new BackendClientError(`HEAD /v1/blobs/${sha256} → ${res.status}`, res.status);
    return true;
  }
  async getBlob(sha256: string): Promise<Uint8Array> {
    const res = await this.doFetch(`${this.baseUrl}/v1/blobs/${encodeURIComponent(sha256)}`, {
      headers: this.headers(),
    });
    if (!res.ok)
      throw new BackendClientError(`GET /v1/blobs/${sha256} → ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
}

// --- payload helpers --------------------------------------------------------
// What we ship in each artifact slot. The backend doesn't validate these shapes; the engine does.
// Screenshot bytes travel as content-addressed blobs (`/v1/blobs`); the artifact slot carries only
// a manifest of sha256 references.

export interface FlowsPayload {
  schema: "site-docs/flows@1";
  files: Record<string, string>; // filename → YAML text
}

export interface AnnotationsPayload {
  schema: "site-docs/annotations-bundle@1";
  files: Record<string, unknown>; // `<flow>/annotations.json` content
}

export interface ScreenshotsPayload {
  schema: "site-docs/screenshots@2";
  files: Record<string, BlobRef>; // workspace-relative path (under docs/) → blob reference
}

export interface StylePayload {
  schema: "site-docs/style-bundle@1";
  yaml: string | null;
  json: unknown;
}

export interface LocatorsPayload {
  schema: "site-docs/locators@1";
  yaml: string | null;
}

// --- stored OAuth tokens (`.auth/backend-token.json`) ------------------------

export interface BackendTokenFile {
  access_token: string;
  refresh_token: string;
  /** Epoch ms the access token expires. */
  expires_at: number;
}

const BACKEND_TOKEN_FILE = "backend-token.json";

export async function loadBackendTokenFile(workspaceDir: string): Promise<BackendTokenFile | null> {
  let text: string;
  try {
    text = await fs.readFile(
      resolveWorkspacePath(workspaceDir, ".auth", BACKEND_TOKEN_FILE),
      "utf8",
    );
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<BackendTokenFile>;
    if (
      typeof parsed.access_token === "string" &&
      typeof parsed.refresh_token === "string" &&
      typeof parsed.expires_at === "number"
    ) {
      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: parsed.expires_at,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist OAuth tokens under the workspace's `.auth/` (operator-local; gitignored), mode 0600. */
export async function saveBackendTokenFile(
  workspaceDir: string,
  tokens: BackendTokenFile,
): Promise<string> {
  await fs.mkdir(resolveWorkspacePath(workspaceDir, ".auth"), { recursive: true });
  const target = await resolveWorkspacePathReal(workspaceDir, ".auth", BACKEND_TOKEN_FILE);
  await fs.writeFile(target, JSON.stringify(tokens, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(target, 0o600);
  return target;
}

/**
 * Resolve the bearer token for a backend call, in priority order:
 *   1. the explicit `token` option,
 *   2. the `SITE_DOCS_TOKEN` env var (the CI path),
 *   3. the workspace's stored OAuth tokens (`.auth/backend-token.json`), refreshing them against
 *      the backend when expired (rotated tokens are written back to the file).
 */
export async function resolveBackendToken(opts: {
  baseUrl: string;
  token?: string;
  workspaceDir?: string;
  fetch?: typeof globalThis.fetch;
  now?: number;
}): Promise<string> {
  if (opts.token) return opts.token;
  if (process.env.SITE_DOCS_TOKEN) return process.env.SITE_DOCS_TOKEN;
  const reloginHint = `set SITE_DOCS_TOKEN or run \`site-docs login --backend-url ${opts.baseUrl} --oauth <workspace-dir>\``;
  if (!opts.workspaceDir) {
    throw new BackendClientError(`no bearer token — ${reloginHint}`);
  }
  const stored = await loadBackendTokenFile(opts.workspaceDir);
  if (!stored) {
    throw new BackendClientError(`no bearer token — ${reloginHint}`);
  }
  const now = opts.now ?? Date.now();
  if (stored.expires_at > now + 30_000) return stored.access_token;
  // Expired (or about to) — attempt a refresh-token rotation.
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  let refreshed: { access_token: string; refresh_token: string; expires_in: number };
  try {
    const res = await doFetch(`${base}/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      }).toString(),
    });
    if (!res.ok) throw new BackendClientError(`token refresh → ${res.status}`, res.status);
    refreshed = (await res.json()) as typeof refreshed;
  } catch (e) {
    throw new BackendClientError(
      `stored backend token expired and the refresh failed (${(e as Error).message}) — ${reloginHint}`,
    );
  }
  const tokens: BackendTokenFile = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: now + refreshed.expires_in * 1000,
  };
  await saveBackendTokenFile(opts.workspaceDir, tokens);
  return tokens.access_token;
}

/** Build a {@link BackendClient} with the token resolved via {@link resolveBackendToken}. */
export async function createBackendClient(
  opts: BackendClientOptions & { workspaceDir?: string },
): Promise<BackendClient> {
  const token = await resolveBackendToken({
    baseUrl: opts.baseUrl,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    ...(opts.workspaceDir !== undefined ? { workspaceDir: opts.workspaceDir } : {}),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
  return new BackendClient({
    baseUrl: opts.baseUrl,
    token,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

// --- OAuth 2.1 + PKCE login (`site-docs login --oauth`) ----------------------

export interface OAuthLoginOptions {
  backendUrl: string;
  /** Receives the authorization URL the operator must open in a browser (the CLI prints it). */
  onAuthorizeUrl: (url: string) => void;
  fetch?: typeof globalThis.fetch;
  /** How long to wait for the browser redirect before giving up. Default 5 minutes. */
  timeoutMs?: number;
}

/**
 * Drive the authorization-code + PKCE handshake against the backend's minimal authorization
 * server: start a loopback listener for the redirect, hand the authorize URL to the caller,
 * await the code, exchange it (S256 verifier) for tokens.
 */
export async function oauthLogin(opts: OAuthLoginOptions): Promise<BackendTokenFile> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.backendUrl.replace(/\/+$/, "");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const gotCode = u.searchParams.get("code");
    if (u.searchParams.get("state") !== state || !gotCode) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("site-docs login: state mismatch or missing code\n");
      rejectCode(new BackendClientError("OAuth redirect carried a bad state or no code"));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("site-docs login complete — you can close this tab.\n");
    resolveCode(gotCode);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new BackendClientError("failed to bind the OAuth callback listener"));
    });
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizeUrl = new URL(`${base}/v1/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", "site-docs-cli");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  opts.onAuthorizeUrl(authorizeUrl.toString());

  const timer = setTimeout(() => {
    rejectCode(new BackendClientError("OAuth login timed out waiting for the browser redirect"));
  }, opts.timeoutMs ?? 300_000);
  timer.unref();

  let code: string;
  try {
    code = await codePromise;
  } finally {
    clearTimeout(timer);
    server.close();
  }

  const res = await doFetch(`${base}/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendClientError(
      `token exchange → ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
}

// --- run-history wiring (`site-docs run`) -------------------------------------

/**
 * Append an execution-run record for a backend-bound workspace. A no-op when the workspace config
 * lacks the backend binding; never throws — `site-docs run` must stay offline-tolerant, so failures
 * come back as a warning string for the caller to surface.
 */
export async function recordRunHistory(opts: {
  workspaceDir: string;
  config: { backend_url?: string; backend_workspace_id?: string; backend_project_id?: string };
  ok: boolean;
  durationMs: number;
  summary: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ recorded: boolean; warning?: string }> {
  const { backend_url, backend_workspace_id, backend_project_id } = opts.config;
  if (!backend_url || !backend_workspace_id || !backend_project_id) return { recorded: false };
  try {
    const client = await createBackendClient({
      baseUrl: backend_url,
      workspaceDir: opts.workspaceDir,
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
    await client.appendRun(backend_workspace_id, backend_project_id, {
      rev: "head",
      ok: opts.ok,
      duration_ms: opts.durationMs,
      summary: opts.summary,
    });
    return { recorded: true };
  } catch (e) {
    return { recorded: false, warning: `failed to record run history: ${(e as Error).message}` };
  }
}

// --- encrypted storage-state cache relay --------------------------------------
// Client-side encryption: the backend stores an opaque AES-256-GCM envelope and never sees the
// plaintext session. The shapes below are structural mirrors of the engine's auth layer
// (`StorageState` / `AuthResult` / `RoleAuth.cache`) — deliberately not imported from auth.ts so
// the modules stay decoupled; the auth layer satisfies them structurally.

export interface CachedStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface CachedAuthResult {
  storageState: CachedStorageState;
  /** Epoch ms when the session is known to expire (e.g. from a cookie's `expires`). Optional. */
  expiresAt?: number;
}

export interface CacheRoleConfig {
  cache: {
    /** `"session"`, a duration string (`30m`, `1h`, `500ms`), or ms as a number. */
    ttl: string | number;
    auth_cookie?: string;
  };
}

export class BackendStateCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendStateCacheError";
  }
}

export interface BackendStateCacheOptions {
  baseUrl: string;
  token: string;
  workspaceId: string;
  /** Base64-encoded 32-byte AES key — the resolved value of `SITE_DOCS_CACHE_KEY`. */
  cacheKey: string;
  fetch?: typeof globalThis.fetch;
}

interface AuthCacheEnvelope {
  schema: "site-docs/auth-cache@1";
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
  expires_at?: number;
}

function ttlToMs(ttl: string | number): number | "session" {
  if (typeof ttl === "number") return ttl;
  const m = /^(\d+)(ms|s|m|h)$/.exec(ttl);
  if (!m) return "session";
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    default:
      return n * 3_600_000;
  }
}

function cookieExpiryByName(state: CachedStorageState, name: string): number | undefined {
  const expiries = state.cookies
    .filter((c) => c.name === name && typeof c.expires === "number" && c.expires > 0)
    .map((c) => c.expires * 1000);
  return expiries.length ? Math.max(...expiries) : undefined;
}

/**
 * Backend-relayed storage-state cache. Same `load` / `save` / `clear` contract as the local
 * `.auth/<role>.json` cache (incl. the expiry-priority rules), but the entry lives on the backend
 * as a client-side-encrypted envelope — usable by a team sharing one backend, opaque to the server.
 */
export class BackendStateCache {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workspaceId: string;
  private readonly key: Buffer;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: BackendStateCacheOptions) {
    if (!opts.cacheKey) {
      throw new BackendStateCacheError(
        "missing cache key — set SITE_DOCS_CACHE_KEY to a base64-encoded 32-byte key",
      );
    }
    const key = Buffer.from(opts.cacheKey, "base64");
    if (key.length !== 32) {
      throw new BackendStateCacheError(
        `malformed cache key — SITE_DOCS_CACHE_KEY must decode to exactly 32 bytes (got ${key.length})`,
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.workspaceId = opts.workspaceId;
    this.key = key;
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  /** Return the cached state for a role if present and not past its expiry; otherwise `null`. */
  async load(role: string, now = Date.now()): Promise<CachedStorageState | null> {
    const res = await this.doFetch(this.url(role), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new BackendClientError(`GET auth-cache(${role}) → ${res.status}`, res.status);
    }
    const envelope = (await res.json()) as AuthCacheEnvelope;
    const plain = this.decrypt(envelope);
    let entry: { storageState?: CachedStorageState; expiresAt?: number };
    try {
      entry = JSON.parse(plain) as typeof entry;
    } catch {
      return null; // corrupt entry → treat as miss (mirrors the local cache)
    }
    if (!entry.storageState || typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
      return null;
    }
    return entry.storageState;
  }

  /**
   * Encrypt + store a captured session, computing its expiry exactly like the local cache:
   * auth-cookie expiry when available, else `ttl`, else the strategy-reported `expiresAt`
   * (if plausibly in the future), else +1h. Refuses to cache an already-dead session.
   */
  async save(
    role: string,
    result: CachedAuthResult,
    roleAuth: CacheRoleConfig,
    now = Date.now(),
    opts: { authCookie?: string } = {},
  ): Promise<{ expiresAt: number; source: string }> {
    const authCookieName = opts.authCookie ?? roleAuth.cache.auth_cookie;
    const fromCookie = authCookieName
      ? cookieExpiryByName(result.storageState, authCookieName)
      : undefined;
    const ttlMs = ttlToMs(roleAuth.cache.ttl);

    let expiresAt: number;
    let source: string;
    if (fromCookie !== undefined) {
      expiresAt = fromCookie;
      source = `auth-cookie "${authCookieName}"`;
    } else if (authCookieName) {
      expiresAt = typeof ttlMs === "number" ? now + ttlMs : now + 3_600_000;
      source = `ttl (fallback — auth-cookie "${authCookieName}" not in the jar or has no expiry)`;
    } else if (typeof ttlMs === "number") {
      expiresAt = now + ttlMs;
      source = "ttl";
    } else {
      const reported =
        result.expiresAt && result.expiresAt > now + 60_000 ? result.expiresAt : undefined;
      expiresAt = reported ?? now + 3_600_000;
      source = reported ? "strategy-reported expiresAt" : "1h default";
    }
    if (expiresAt <= now) {
      throw new BackendStateCacheError(
        `computed cache expiry (${new Date(expiresAt).toISOString()}, from ${source}) is not in the future — refusing to cache a dead session`,
      );
    }

    const entry = { storageState: result.storageState, writtenAt: now, expiresAt };
    const envelope: AuthCacheEnvelope = {
      ...this.encrypt(JSON.stringify(entry)),
      expires_at: expiresAt,
    };
    const res = await this.doFetch(this.url(role), {
      method: "PUT",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new BackendClientError(`PUT auth-cache(${role}) → ${res.status}`, res.status);
    }
    return { expiresAt, source };
  }

  async clear(role: string): Promise<void> {
    const res = await this.doFetch(this.url(role), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new BackendClientError(`DELETE auth-cache(${role}) → ${res.status}`, res.status);
    }
  }

  private url(role: string): string {
    return `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.workspaceId)}/auth-cache/${encodeURIComponent(role)}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      [API_VERSION_HEADER]: API_VERSION,
      ...(extra ?? {}),
    };
  }

  private encrypt(plain: string): Omit<AuthCacheEnvelope, "expires_at"> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return {
      schema: "site-docs/auth-cache@1",
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  private decrypt(envelope: AuthCacheEnvelope): string {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new BackendStateCacheError(
        "auth-cache decryption failed — wrong SITE_DOCS_CACHE_KEY or tampered ciphertext",
      );
    }
  }
}
