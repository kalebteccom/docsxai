// Store contract + the in-memory implementation. Linear immutable revisions; artifact payloads are
// opaque JSON (the backend never validates doc-pack contents — that's the engine's job). Blobs are
// content-addressed by sha256 and shared across revisions. `MemoryStore` resets per process; the
// filesystem-backed `FsStore` (fs-store.ts) persists the same shapes under a data dir.

import { createHash, randomUUID } from "node:crypto";
import {
  type AuthCacheEnvelope,
  type BlobRef,
  type Project,
  type Revision,
  type RevisionArtifact,
  type RevisionKind,
  type RunRecord,
  type WebhookConfig,
  type Workspace,
} from "./api.js";

/** How many recent webhook delivery ids the replay guard remembers. */
export const WEBHOOK_DELIVERY_MEMORY = 100;

/** Result of mapping an incoming webhook repo to a configured project. */
export interface WebhookProjectMatch {
  workspace_id: string;
  project_id: string;
  config: WebhookConfig;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** Thrown by `putArtifact` when the target revision has been finalized (HTTP 409 `revision-finalized`). */
export class RevisionFinalizedError extends Error {
  constructor(revId: string) {
    super(`revision ${revId} is finalized — its artifacts are immutable`);
    this.name = "RevisionFinalizedError";
  }
}

export interface RunInput {
  rev: string;
  ok: boolean;
  duration_ms: number;
  summary: string;
}

/** The persistence surface the HTTP server drives. Implementations: `MemoryStore`, `FsStore`. */
export interface BackendStore {
  createWorkspace(name: string): Workspace;
  listWorkspaces(): Workspace[];
  getWorkspace(id: string): Workspace;

  createProject(wsId: string, name: string): Project;
  listProjects(wsId: string): Project[];
  getProject(wsId: string, projectId: string): Project;

  createRevision(wsId: string, projectId: string, kind: RevisionKind, author: string): Revision;
  listRevisions(wsId: string, projectId: string): Revision[];
  getRevision(wsId: string, projectId: string, revId: string): Revision;
  /** Idempotent: finalizing an already-finalized revision is a no-op. */
  finalizeRevision(wsId: string, projectId: string, revId: string): Revision;

  /** Throws {@link RevisionFinalizedError} if the revision has been finalized. */
  putArtifact(
    wsId: string,
    projectId: string,
    revId: string,
    artifact: RevisionArtifact,
    payload: unknown,
  ): Revision;
  getArtifact(wsId: string, projectId: string, revId: string, artifact: RevisionArtifact): unknown;

  appendRun(wsId: string, projectId: string, rec: RunInput): RunRecord;
  listRuns(wsId: string, projectId: string): RunRecord[];

  /** Content-addressed and idempotent: re-storing the same bytes returns the same ref. */
  putBlob(data: Buffer): BlobRef;
  hasBlob(sha256: string): BlobRef | null;
  getBlob(sha256: string): Buffer;

  putAuthCache(wsId: string, role: string, envelope: AuthCacheEnvelope): void;
  getAuthCache(wsId: string, role: string): AuthCacheEnvelope;
  /** Idempotent: deleting an absent entry is a no-op. */
  deleteAuthCache(wsId: string, role: string): void;

  putWebhookConfig(wsId: string, projectId: string, config: WebhookConfig): WebhookConfig;
  /** Throws {@link NotFoundError} when the project has no webhook config. */
  getWebhookConfig(wsId: string, projectId: string): WebhookConfig;
  /** Map a GitHub `owner/name` repo to the first project configured for it (or null). */
  findWebhookProject(repo: string): WebhookProjectMatch | null;
  /**
   * Replay guard: record a webhook delivery id, remembering the last
   * {@link WEBHOOK_DELIVERY_MEMORY}. Returns false when the id was already seen (duplicate).
   */
  rememberWebhookDelivery(deliveryId: string): boolean;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

interface RevisionEntry extends Revision {
  payloads: Partial<Record<RevisionArtifact, unknown>>;
}

interface ProjectEntry extends Project {
  revisions: RevisionEntry[]; // newest last
  runs: RunRecord[]; // newest last
  webhook_config?: WebhookConfig;
}

const now = () => new Date().toISOString();

export class MemoryStore implements BackendStore {
  private workspaces = new Map<string, Workspace>();
  private projects = new Map<string, ProjectEntry>();
  private blobs = new Map<string, Buffer>();
  private authCache = new Map<string, AuthCacheEnvelope>();
  private deliveries: string[] = []; // webhook delivery ids, oldest first, capped

  // --- workspaces ---
  createWorkspace(name: string): Workspace {
    const ws: Workspace = { id: randomUUID(), name, created_at: now() };
    this.workspaces.set(ws.id, ws);
    return ws;
  }
  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()];
  }
  getWorkspace(id: string): Workspace {
    const w = this.workspaces.get(id);
    if (!w) throw new NotFoundError(`workspace ${id}`);
    return w;
  }

  // --- projects ---
  createProject(wsId: string, name: string): Project {
    this.getWorkspace(wsId);
    const p: ProjectEntry = {
      id: randomUUID(),
      workspace_id: wsId,
      name,
      created_at: now(),
      head_revision_id: null,
      revisions: [],
      runs: [],
    };
    this.projects.set(p.id, p);
    return this.publicProject(p);
  }
  listProjects(wsId: string): Project[] {
    this.getWorkspace(wsId);
    return [...this.projects.values()]
      .filter((p) => p.workspace_id === wsId)
      .map((p) => this.publicProject(p));
  }
  getProject(wsId: string, projectId: string): Project {
    return this.publicProject(this.projectEntry(wsId, projectId));
  }

  // --- revisions ---
  createRevision(wsId: string, projectId: string, kind: RevisionKind, author: string): Revision {
    const p = this.projectEntry(wsId, projectId);
    const parent = p.revisions.length ? p.revisions[p.revisions.length - 1]!.id : null;
    const rev: RevisionEntry = {
      id: randomUUID(),
      project_id: projectId,
      parent_revision_id: parent,
      kind,
      author,
      created_at: now(),
      artifacts: [],
      finalized: false,
      payloads: {},
    };
    p.revisions.push(rev);
    p.head_revision_id = rev.id;
    return this.publicRevision(rev);
  }
  listRevisions(wsId: string, projectId: string): Revision[] {
    const p = this.projectEntry(wsId, projectId);
    return [...p.revisions].reverse().map((r) => this.publicRevision(r));
  }
  getRevision(wsId: string, projectId: string, revId: string): Revision {
    return this.publicRevision(this.revisionEntry(wsId, projectId, revId));
  }
  finalizeRevision(wsId: string, projectId: string, revId: string): Revision {
    const rev = this.revisionEntry(wsId, projectId, revId);
    rev.finalized = true;
    return this.publicRevision(rev);
  }
  putArtifact(
    wsId: string,
    projectId: string,
    revId: string,
    artifact: RevisionArtifact,
    payload: unknown,
  ): Revision {
    const rev = this.revisionEntry(wsId, projectId, revId);
    if (rev.finalized) throw new RevisionFinalizedError(rev.id);
    rev.payloads[artifact] = payload;
    if (!rev.artifacts.includes(artifact)) rev.artifacts.push(artifact);
    return this.publicRevision(rev);
  }
  getArtifact(wsId: string, projectId: string, revId: string, artifact: RevisionArtifact): unknown {
    const rev = this.revisionEntry(wsId, projectId, revId);
    if (!(artifact in rev.payloads))
      throw new NotFoundError(`artifact ${artifact} on revision ${rev.id}`);
    return rev.payloads[artifact];
  }

  // --- run history ---
  appendRun(wsId: string, projectId: string, rec: RunInput): RunRecord {
    const p = this.projectEntry(wsId, projectId);
    this.revisionEntry(wsId, projectId, rec.rev); // validate the revision exists
    const run: RunRecord = {
      id: randomUUID(),
      project_id: projectId,
      revision_id: rec.rev === "head" ? p.head_revision_id! : rec.rev,
      ok: rec.ok,
      duration_ms: rec.duration_ms,
      summary: rec.summary,
      created_at: now(),
    };
    p.runs.push(run);
    return run;
  }
  listRuns(wsId: string, projectId: string): RunRecord[] {
    return [...this.projectEntry(wsId, projectId).runs].reverse();
  }

  // --- blobs ---
  putBlob(data: Buffer): BlobRef {
    const sha256 = sha256Hex(data);
    if (!this.blobs.has(sha256)) this.blobs.set(sha256, Buffer.from(data));
    return { sha256, bytes: data.byteLength };
  }
  hasBlob(sha256: string): BlobRef | null {
    const b = this.blobs.get(sha256);
    return b ? { sha256, bytes: b.byteLength } : null;
  }
  getBlob(sha256: string): Buffer {
    const b = this.blobs.get(sha256);
    if (!b) throw new NotFoundError(`blob ${sha256}`);
    return b;
  }

  // --- auth cache ---
  putAuthCache(wsId: string, role: string, envelope: AuthCacheEnvelope): void {
    this.getWorkspace(wsId);
    this.authCache.set(`${wsId}\0${role}`, envelope);
  }
  getAuthCache(wsId: string, role: string): AuthCacheEnvelope {
    this.getWorkspace(wsId);
    const e = this.authCache.get(`${wsId}\0${role}`);
    if (!e) throw new NotFoundError(`auth-cache entry for role ${role} in workspace ${wsId}`);
    return e;
  }
  deleteAuthCache(wsId: string, role: string): void {
    this.getWorkspace(wsId);
    this.authCache.delete(`${wsId}\0${role}`);
  }

  // --- webhook config + replay guard ---
  putWebhookConfig(wsId: string, projectId: string, config: WebhookConfig): WebhookConfig {
    const p = this.projectEntry(wsId, projectId);
    p.webhook_config = { ...config };
    return { ...config };
  }
  getWebhookConfig(wsId: string, projectId: string): WebhookConfig {
    const p = this.projectEntry(wsId, projectId);
    if (!p.webhook_config) throw new NotFoundError(`webhook config for project ${projectId}`);
    return { ...p.webhook_config };
  }
  findWebhookProject(repo: string): WebhookProjectMatch | null {
    for (const p of this.projects.values()) {
      if (p.webhook_config?.repo === repo) {
        return {
          workspace_id: p.workspace_id,
          project_id: p.id,
          config: { ...p.webhook_config },
        };
      }
    }
    return null;
  }
  rememberWebhookDelivery(deliveryId: string): boolean {
    if (this.deliveries.includes(deliveryId)) return false;
    this.deliveries.push(deliveryId);
    if (this.deliveries.length > WEBHOOK_DELIVERY_MEMORY) {
      this.deliveries.splice(0, this.deliveries.length - WEBHOOK_DELIVERY_MEMORY);
    }
    return true;
  }

  // --- internals ---
  private projectEntry(wsId: string, projectId: string): ProjectEntry {
    this.getWorkspace(wsId);
    const p = this.projects.get(projectId);
    if (!p || p.workspace_id !== wsId)
      throw new NotFoundError(`project ${projectId} in workspace ${wsId}`);
    return p;
  }
  private revisionEntry(wsId: string, projectId: string, revId: string): RevisionEntry {
    const p = this.projectEntry(wsId, projectId);
    const id = revId === "head" ? p.head_revision_id : revId;
    const rev = id ? p.revisions.find((r) => r.id === id) : undefined;
    if (!rev) throw new NotFoundError(`revision ${revId} in project ${projectId}`);
    return rev;
  }
  private publicProject(p: ProjectEntry): Project {
    const { revisions: _r, runs: _u, webhook_config: _w, ...rest } = p;
    return { ...rest };
  }
  private publicRevision(r: RevisionEntry): Revision {
    const { payloads: _p, ...rest } = r;
    return { ...rest, artifacts: [...rest.artifacts] };
  }
}

export { MemoryStore as Store };
