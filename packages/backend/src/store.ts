// In-memory store for the backend stub. Linear immutable revisions; artifact payloads are opaque JSON
// (the backend never validates doc-pack contents — that's the engine's job). Not persistent; resets per process.

import { randomUUID } from "node:crypto";
import {
  type Project,
  type Revision,
  type RevisionArtifact,
  type RevisionKind,
  type RunRecord,
  type Workspace,
} from "./api.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

interface RevisionEntry extends Revision {
  payloads: Partial<Record<RevisionArtifact, unknown>>;
}

interface ProjectEntry extends Project {
  revisions: RevisionEntry[]; // newest last
  runs: RunRecord[]; // newest last
}

const now = () => new Date().toISOString();

export class Store {
  private workspaces = new Map<string, Workspace>();
  private projects = new Map<string, ProjectEntry>();

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
    return [...this.projects.values()].filter((p) => p.workspace_id === wsId).map((p) => this.publicProject(p));
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
  putArtifact(wsId: string, projectId: string, revId: string, artifact: RevisionArtifact, payload: unknown): Revision {
    const rev = this.revisionEntry(wsId, projectId, revId);
    rev.payloads[artifact] = payload;
    if (!rev.artifacts.includes(artifact)) rev.artifacts.push(artifact);
    return this.publicRevision(rev);
  }
  getArtifact(wsId: string, projectId: string, revId: string, artifact: RevisionArtifact): unknown {
    const rev = this.revisionEntry(wsId, projectId, revId);
    if (!(artifact in rev.payloads)) throw new NotFoundError(`artifact ${artifact} on revision ${rev.id}`);
    return rev.payloads[artifact];
  }

  // --- run history ---
  appendRun(
    wsId: string,
    projectId: string,
    rec: { rev: string; ok: boolean; duration_ms: number; summary: string },
  ): RunRecord {
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

  // --- internals ---
  private projectEntry(wsId: string, projectId: string): ProjectEntry {
    this.getWorkspace(wsId);
    const p = this.projects.get(projectId);
    if (!p || p.workspace_id !== wsId) throw new NotFoundError(`project ${projectId} in workspace ${wsId}`);
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
    const { revisions: _r, runs: _u, ...rest } = p;
    return { ...rest };
  }
  private publicRevision(r: RevisionEntry): Revision {
    const { payloads: _p, ...rest } = r;
    return { ...rest, artifacts: [...rest.artifacts] };
  }
}
