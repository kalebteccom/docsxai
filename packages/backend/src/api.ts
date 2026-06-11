// Backend API contract — the concrete endpoint list.
//
// REST + per-resource endpoints under /v1/workspaces/{ws}/projects/{project}/revisions/{rev}/...
// Auth: OAuth 2.1 in production (authorization-code+PKCE for humans, pre-issued workspace-scoped bearer
// token for CI). This stub accepts any `Authorization: Bearer <token>` (optionally matched against
// SITE_DOCS_TOKEN) — the OAuth handshake itself is out of scope for the stub.
// Versioning: clients send `Site-Docs-API-Version: 1`; the server echoes it and warns on mismatch.
// Revisions: linear and immutable — POST .../revisions creates a new revision whose parent is the current head.

export const API_VERSION = "1" as const;
export const API_VERSION_HEADER = "site-docs-api-version";

/** The artifact slots a revision carries (mirrors the on-disk doc pack). Payloads are opaque to the backend. */
export const REVISION_ARTIFACTS = [
  "flows",
  "annotations",
  "screenshots",
  "style",
  "locators",
] as const;
export type RevisionArtifact = (typeof REVISION_ARTIFACTS)[number];

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

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
