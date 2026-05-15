// HTTP client for `@kalebtec/site-docs-backend`. Used by `site-docs push` / `pull` / `login`.
//
// The contract types are *redeclared* here (not imported from the backend package) so the engine
// stays decoupled at the package level — there's no runtime nor build-time dep on the backend.
// Drift is caught by the round-trip integration test that spins up a real stub. The shapes mirror
// the backend's `api.ts` exactly; if you change one, update the other and the test will tell you.

import { type StorageState } from "./auth.js";

export const API_VERSION = "1" as const;
export const API_VERSION_HEADER = "site-docs-api-version";

export type RevisionArtifact = "flows" | "annotations" | "screenshots" | "style" | "locators";
export type RevisionKind = "calibrate" | "run" | "edit";

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
}

export class BackendClientError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
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
      throw new BackendClientError(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`, res.status, parsed);
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
    return this.req("GET", `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}`);
  }

  // --- revisions ---
  listRevisions(wsId: string, projectId: string): Promise<Revision[]> {
    return this.req("GET", `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions`);
  }
  createRevision(wsId: string, projectId: string, body: { kind: RevisionKind; author: string }): Promise<Revision> {
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
  getArtifact<T = unknown>(wsId: string, projectId: string, rev: string, artifact: RevisionArtifact): Promise<T> {
    return this.req(
      "GET",
      `/v1/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(rev)}/${artifact}`,
    );
  }
}

// --- payload helpers --------------------------------------------------------
// What we ship in each artifact slot. The backend doesn't validate these shapes; the engine does.
// Screenshots are base64'd inside JSON for transport — fine for the in-memory stub, replaced by
// presigned-URL upload when the backend grows real storage (Phase 2).

export interface FlowsPayload {
  schema: "site-docs/flows@1";
  files: Record<string, string>; // filename → YAML text
}

export interface AnnotationsPayload {
  schema: "site-docs/annotations-bundle@1";
  files: Record<string, unknown>; // `<flow>/annotations.json` content
}

export interface ScreenshotsPayload {
  schema: "site-docs/screenshots@1";
  files: Record<string, string>; // path → base64 PNG
}

export interface StylePayload {
  schema: "site-docs/style-bundle@1";
  yaml: string | null;
  json: unknown | null;
}

export interface LocatorsPayload {
  schema: "site-docs/locators@1";
  yaml: string | null;
}

/** Currently-unused — placeholder for the storageState relay if the workspace ever opts in to `store: backend`. */
export type StorageStatePayload = StorageState;
