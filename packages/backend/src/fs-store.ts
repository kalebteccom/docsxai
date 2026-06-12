// Filesystem-backed store. Layout under the data dir:
//
//   workspaces.json
//   projects/<projectId>/meta.json            (Project + the ordered revision-id list)
//   projects/<projectId>/runs.json
//   projects/<projectId>/revisions/<revId>/meta.json
//   projects/<projectId>/revisions/<revId>/artifacts/<slot>.json
//   blobs/<sha256>                            (content-addressed, shared across revisions)
//   auth-cache/<wsId>/<role>.json
//
// Every write is atomic (tmp file + rename in the same directory). Every read goes to disk — no
// caching layer, so concurrent processes pointed at the same data dir see each other's writes.
// Every path join is containment-guarded against the data root (URL params feed the segments).

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AuthCacheEnvelope,
  type BlobRef,
  type Project,
  type Revision,
  type RevisionArtifact,
  type RevisionKind,
  type RunRecord,
  type Workspace,
} from "./api.js";
import {
  type BackendStore,
  NotFoundError,
  RevisionFinalizedError,
  type RunInput,
  sha256Hex,
} from "./store.js";

/** Thrown when a data-dir-relative path resolves outside the data root (traversal attempt). */
export class DataPathEscapeError extends Error {
  constructor(
    readonly dataDir: string,
    readonly resolvedPath: string,
  ) {
    super(`path escapes backend data dir ${dataDir}: ${resolvedPath}`);
    this.name = "DataPathEscapeError";
  }
}

interface ProjectMetaFile extends Project {
  /** Revision ids, oldest first. Internal to the on-disk layout — stripped from public reads. */
  revision_ids: string[];
}

const now = () => new Date().toISOString();

export class FsStore implements BackendStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir);
    fs.mkdirSync(this.root, { recursive: true });
  }

  // --- workspaces ---
  createWorkspace(name: string): Workspace {
    const ws: Workspace = { id: randomUUID(), name, created_at: now() };
    this.writeJson(this.resolve("workspaces.json"), [...this.readWorkspaces(), ws]);
    return ws;
  }
  listWorkspaces(): Workspace[] {
    return this.readWorkspaces();
  }
  getWorkspace(id: string): Workspace {
    const w = this.readWorkspaces().find((x) => x.id === id);
    if (!w) throw new NotFoundError(`workspace ${id}`);
    return w;
  }

  // --- projects ---
  createProject(wsId: string, name: string): Project {
    this.getWorkspace(wsId);
    const meta: ProjectMetaFile = {
      id: randomUUID(),
      workspace_id: wsId,
      name,
      created_at: now(),
      head_revision_id: null,
      revision_ids: [],
    };
    this.writeJson(this.resolve("projects", meta.id, "meta.json"), meta);
    return publicProject(meta);
  }
  listProjects(wsId: string): Project[] {
    this.getWorkspace(wsId);
    const projectsDir = this.resolve("projects");
    let ids: string[];
    try {
      ids = fs.readdirSync(projectsDir);
    } catch {
      return [];
    }
    const out: Project[] = [];
    for (const id of ids.sort()) {
      const meta = this.readJson<ProjectMetaFile>(this.resolve("projects", id, "meta.json"));
      if (meta && meta.workspace_id === wsId) out.push(publicProject(meta));
    }
    return out;
  }
  getProject(wsId: string, projectId: string): Project {
    return publicProject(this.projectMeta(wsId, projectId));
  }

  // --- revisions ---
  createRevision(wsId: string, projectId: string, kind: RevisionKind, author: string): Revision {
    const meta = this.projectMeta(wsId, projectId);
    const rev: Revision = {
      id: randomUUID(),
      project_id: projectId,
      parent_revision_id: meta.head_revision_id,
      kind,
      author,
      created_at: now(),
      artifacts: [],
      finalized: false,
    };
    this.writeJson(this.revisionMetaPath(projectId, rev.id), rev);
    meta.head_revision_id = rev.id;
    meta.revision_ids.push(rev.id);
    this.writeJson(this.resolve("projects", projectId, "meta.json"), meta);
    return rev;
  }
  listRevisions(wsId: string, projectId: string): Revision[] {
    const meta = this.projectMeta(wsId, projectId);
    return [...meta.revision_ids]
      .reverse()
      .map((id) => this.revisionMeta(wsId, projectId, id, { projectMeta: meta }));
  }
  getRevision(wsId: string, projectId: string, revId: string): Revision {
    return this.revisionMeta(wsId, projectId, revId);
  }
  finalizeRevision(wsId: string, projectId: string, revId: string): Revision {
    const rev = this.revisionMeta(wsId, projectId, revId);
    if (!rev.finalized) {
      rev.finalized = true;
      this.writeJson(this.revisionMetaPath(projectId, rev.id), rev);
    }
    return rev;
  }
  putArtifact(
    wsId: string,
    projectId: string,
    revId: string,
    artifact: RevisionArtifact,
    payload: unknown,
  ): Revision {
    const rev = this.revisionMeta(wsId, projectId, revId);
    if (rev.finalized) throw new RevisionFinalizedError(rev.id);
    this.writeJson(
      this.resolve("projects", projectId, "revisions", rev.id, "artifacts", `${artifact}.json`),
      payload,
    );
    if (!rev.artifacts.includes(artifact)) {
      rev.artifacts.push(artifact);
      this.writeJson(this.revisionMetaPath(projectId, rev.id), rev);
    }
    return rev;
  }
  getArtifact(wsId: string, projectId: string, revId: string, artifact: RevisionArtifact): unknown {
    const rev = this.revisionMeta(wsId, projectId, revId);
    const payload = this.readJson<unknown>(
      this.resolve("projects", projectId, "revisions", rev.id, "artifacts", `${artifact}.json`),
    );
    if (payload === undefined)
      throw new NotFoundError(`artifact ${artifact} on revision ${rev.id}`);
    return payload;
  }

  // --- run history ---
  appendRun(wsId: string, projectId: string, rec: RunInput): RunRecord {
    const meta = this.projectMeta(wsId, projectId);
    this.revisionMeta(wsId, projectId, rec.rev, { projectMeta: meta }); // validate it exists
    const run: RunRecord = {
      id: randomUUID(),
      project_id: projectId,
      revision_id: rec.rev === "head" ? meta.head_revision_id! : rec.rev,
      ok: rec.ok,
      duration_ms: rec.duration_ms,
      summary: rec.summary,
      created_at: now(),
    };
    const runsPath = this.resolve("projects", projectId, "runs.json");
    this.writeJson(runsPath, [...(this.readJson<RunRecord[]>(runsPath) ?? []), run]);
    return run;
  }
  listRuns(wsId: string, projectId: string): RunRecord[] {
    this.projectMeta(wsId, projectId);
    const runs = this.readJson<RunRecord[]>(this.resolve("projects", projectId, "runs.json")) ?? [];
    return runs.reverse();
  }

  // --- blobs ---
  putBlob(data: Buffer): BlobRef {
    const sha256 = sha256Hex(data);
    const target = this.resolve("blobs", sha256);
    if (!fs.existsSync(target)) this.writeAtomic(target, data);
    return { sha256, bytes: data.byteLength };
  }
  hasBlob(sha256: string): BlobRef | null {
    try {
      const st = fs.statSync(this.resolve("blobs", sha256));
      return { sha256, bytes: st.size };
    } catch {
      return null;
    }
  }
  getBlob(sha256: string): Buffer {
    try {
      return fs.readFileSync(this.resolve("blobs", sha256));
    } catch {
      throw new NotFoundError(`blob ${sha256}`);
    }
  }

  // --- auth cache ---
  putAuthCache(wsId: string, role: string, envelope: AuthCacheEnvelope): void {
    this.getWorkspace(wsId);
    this.writeJson(this.resolve("auth-cache", wsId, `${role}.json`), envelope);
  }
  getAuthCache(wsId: string, role: string): AuthCacheEnvelope {
    this.getWorkspace(wsId);
    const e = this.readJson<AuthCacheEnvelope>(this.resolve("auth-cache", wsId, `${role}.json`));
    if (!e) throw new NotFoundError(`auth-cache entry for role ${role} in workspace ${wsId}`);
    return e;
  }
  deleteAuthCache(wsId: string, role: string): void {
    this.getWorkspace(wsId);
    fs.rmSync(this.resolve("auth-cache", wsId, `${role}.json`), { force: true });
  }

  // --- internals ---
  /** Resolve segments against the data root, guaranteeing containment (segments carry URL params). */
  private resolve(...segments: string[]): string {
    const resolved = path.resolve(this.root, ...segments);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new DataPathEscapeError(this.root, resolved);
    }
    return resolved;
  }

  private writeAtomic(target: string, data: Buffer | string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${randomUUID()}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  }

  private writeJson(target: string, value: unknown): void {
    this.writeAtomic(target, JSON.stringify(value, null, 2) + "\n");
  }

  /** Read + parse a JSON file; `undefined` if it doesn't exist. */
  private readJson<T>(p: string): T | undefined {
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
    return JSON.parse(text) as T;
  }

  private readWorkspaces(): Workspace[] {
    return this.readJson<Workspace[]>(this.resolve("workspaces.json")) ?? [];
  }

  private projectMeta(wsId: string, projectId: string): ProjectMetaFile {
    this.getWorkspace(wsId);
    const meta = this.readJsonGuarded<ProjectMetaFile>(() =>
      this.resolve("projects", projectId, "meta.json"),
    );
    if (!meta || meta.workspace_id !== wsId)
      throw new NotFoundError(`project ${projectId} in workspace ${wsId}`);
    return meta;
  }

  private revisionMetaPath(projectId: string, revId: string): string {
    return this.resolve("projects", projectId, "revisions", revId, "meta.json");
  }

  private revisionMeta(
    wsId: string,
    projectId: string,
    revId: string,
    opts: { projectMeta?: ProjectMetaFile } = {},
  ): Revision {
    const meta = opts.projectMeta ?? this.projectMeta(wsId, projectId);
    const id = revId === "head" ? meta.head_revision_id : revId;
    const rev = id
      ? this.readJsonGuarded<Revision>(() => this.revisionMetaPath(projectId, id))
      : undefined;
    if (!rev || rev.project_id !== projectId)
      throw new NotFoundError(`revision ${revId} in project ${projectId}`);
    return rev;
  }

  /** Read JSON at a guarded path; a traversal-shaped id reads as "not found" rather than escaping. */
  private readJsonGuarded<T>(resolvePath: () => string): T | undefined {
    let p: string;
    try {
      p = resolvePath();
    } catch (e) {
      if (e instanceof DataPathEscapeError) return undefined;
      throw e;
    }
    return this.readJson<T>(p);
  }
}

function publicProject(meta: ProjectMetaFile): Project {
  const { revision_ids: _r, ...rest } = meta;
  return rest;
}
