// Backend API contract — the concrete endpoint list.
//
// REST + per-resource endpoints under /v1/workspaces/{ws}/projects/{project}/revisions/{rev}/...
// Auth: OAuth 2.1 authorization-code+PKCE for humans (the backend is its own minimal authorization
// server — see /v1/oauth/*), pre-issued bearer token (SITE_DOCS_TOKEN) for CI.
// Versioning: clients send `Site-Docs-API-Version: 1`; the server echoes it and warns on mismatch.
// Revisions: linear and immutable — POST .../revisions creates a new revision whose parent is the
// current head; finalizing a revision freezes its artifacts (PUT after finalize → 409).
// Binary artifacts (screenshots) travel as content-addressed blobs under /v1/blobs.

export const API_VERSION = "1" as const;
export const API_VERSION_HEADER = "site-docs-api-version";

/** Maximum accepted JSON request body. Larger bodies get a 413 `ApiError`. */
export const JSON_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
/** Maximum accepted raw blob body (`POST /v1/blobs`). Larger bodies get a 413 `ApiError`. */
export const BLOB_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

/** The only OAuth client this authorization server knows. */
export const OAUTH_CLIENT_ID = "site-docs-cli";

/** The artifact slots a revision carries (mirrors the on-disk doc pack). Payloads are opaque to the backend. */
export const REVISION_ARTIFACTS = [
  "flows",
  "annotations",
  "screenshots",
  "style",
  "locators",
] as const;
export type RevisionArtifact = (typeof REVISION_ARTIFACTS)[number];

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE";

export interface RouteSpec {
  method: HttpMethod;
  /** Path pattern with `:param` segments. */
  path: string;
  summary: string;
}

/** The endpoint list. Stable enough to hand to an implementing agent; the stub serves exactly these. */
export const ROUTES: readonly RouteSpec[] = [
  { method: "GET", path: "/v1/health", summary: "Liveness probe (no auth)." },
  { method: "GET", path: "/v1/workspaces", summary: "List workspaces visible to the caller." },
  { method: "POST", path: "/v1/workspaces", summary: "Create a workspace ({ name })." },
  { method: "GET", path: "/v1/workspaces/:ws", summary: "Get a workspace." },
  { method: "GET", path: "/v1/workspaces/:ws/projects", summary: "List projects in a workspace." },
  { method: "POST", path: "/v1/workspaces/:ws/projects", summary: "Create a project ({ name })." },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/projects/:project",
    summary: "Get a project (incl. head revision).",
  },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/projects/:project/revisions",
    summary: "List revisions (newest first).",
  },
  {
    method: "POST",
    path: "/v1/workspaces/:ws/projects/:project/revisions",
    summary: "Create a new revision ({ kind: calibrate|run|edit, author }); parent = current head.",
  },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/projects/:project/revisions/:rev",
    summary: "Get a revision's metadata + which artifacts are present. `:rev` may be `head`.",
  },
  {
    method: "POST",
    path: "/v1/workspaces/:ws/projects/:project/revisions/:rev/finalize",
    summary: "Finalize a revision (idempotent). Artifact PUTs afterwards → 409 revision-finalized.",
  },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact",
    summary: "Get an artifact payload (artifact ∈ flows|annotations|screenshots|style|locators).",
  },
  {
    method: "PUT",
    path: "/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact",
    summary: "Replace an artifact payload on a (non-finalised) revision.",
  },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/projects/:project/run-history",
    summary: "List execution-run records for the project (newest first).",
  },
  {
    method: "POST",
    path: "/v1/workspaces/:ws/projects/:project/run-history",
    summary: "Append an execution-run record ({ rev, ok, duration_ms, summary }).",
  },
  {
    method: "POST",
    path: "/v1/blobs",
    summary:
      "Store a content-addressed blob (raw body, ≤25 MB). Returns { sha256, bytes }. Idempotent.",
  },
  {
    method: "HEAD",
    path: "/v1/blobs/:sha256",
    summary: "Probe whether a blob exists (200 with Content-Length, or 404).",
  },
  {
    method: "GET",
    path: "/v1/blobs/:sha256",
    summary: "Fetch a blob's raw bytes (application/octet-stream).",
  },
  {
    method: "PUT",
    path: "/v1/workspaces/:ws/auth-cache/:role",
    summary: "Store a client-side-encrypted storage-state envelope (opaque to the backend).",
  },
  {
    method: "GET",
    path: "/v1/workspaces/:ws/auth-cache/:role",
    summary: "Fetch the encrypted storage-state envelope for a role.",
  },
  {
    method: "DELETE",
    path: "/v1/workspaces/:ws/auth-cache/:role",
    summary: "Delete the encrypted storage-state envelope for a role (idempotent).",
  },
  {
    method: "GET",
    path: "/v1/oauth/authorize",
    summary:
      "OAuth 2.1 authorization endpoint (PKCE S256 only; loopback redirect URIs only). 302 with ?code=&state=.",
  },
  {
    method: "POST",
    path: "/v1/oauth/token",
    summary:
      "OAuth 2.1 token endpoint (form-encoded): authorization_code + PKCE verifier, or refresh_token (rotating).",
  },
] as const;

// --- Resource shapes (what the JSON bodies look like) ----------------------

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
  /** id of the most recent revision, or null if none yet. */
  head_revision_id: string | null;
}

export type RevisionKind = "calibrate" | "run" | "edit";

export interface Revision {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  kind: RevisionKind;
  author: string;
  created_at: string;
  /** Which artifact slots have a payload. */
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

export interface ApiError {
  error: string;
  message: string;
}

/** Reference to a stored content-addressed blob. */
export interface BlobRef {
  sha256: string;
  bytes: number;
}

/**
 * Client-side-encrypted storage-state envelope relayed through the backend. The backend validates
 * the shape and stores it opaquely — it never sees the plaintext (the AES-256-GCM key never leaves
 * the client; see `SITE_DOCS_CACHE_KEY`).
 */
export interface AuthCacheEnvelope {
  schema: "site-docs/auth-cache@1";
  alg: "aes-256-gcm";
  /** Base64-encoded 12-byte GCM IV. */
  iv: string;
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded 16-byte GCM auth tag. */
  tag: string;
  /** Epoch ms the cached session expires (cleartext metadata so the server can GC). */
  expires_at?: number;
}

export function isAuthCacheEnvelope(v: unknown): v is AuthCacheEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    e.schema === "site-docs/auth-cache@1" &&
    e.alg === "aes-256-gcm" &&
    typeof e.iv === "string" &&
    e.iv.length > 0 &&
    typeof e.ciphertext === "string" &&
    e.ciphertext.length > 0 &&
    typeof e.tag === "string" &&
    e.tag.length > 0 &&
    (e.expires_at === undefined || typeof e.expires_at === "number")
  );
}
