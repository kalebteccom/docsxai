// REST transport for `@docsxai/backend`: the {@link BackendClient} HTTP surface, plus the
// token-resolving {@link createBackendClient} factory and the `docsxai run` history relay. Used by
// `docsxai push` / `pull` / `login` / `run`. Re-exported from `./backend-client.js`.

import { type RevisionKind } from "./doc-pack.js";
import {
  API_VERSION,
  API_VERSION_HEADER,
  BackendClientError,
  type BackendClientOptions,
  type BlobRef,
  type Project,
  type Revision,
  type RevisionArtifact,
  type RunRecord,
  type Workspace,
} from "./backend-client-contracts.js";
import { resolveBackendToken } from "./backend-client-token.js";

export class BackendClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: BackendClientOptions) {
    if (!opts.baseUrl) throw new BackendClientError("baseUrl is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token ?? process.env.DOCSX_TOKEN ?? "";
    this.doFetch = opts.fetch ?? globalThis.fetch;
    if (!this.token) {
      throw new BackendClientError(
        "no bearer token — set DOCSX_TOKEN env var or pass `token`. Run `docsxai login` to validate.",
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

// --- run-history wiring (`docsxai run`) -------------------------------------

/**
 * Append an execution-run record for a backend-bound workspace. A no-op when the workspace config
 * lacks the backend binding; never throws — `docsxai run` must stay offline-tolerant, so failures
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
