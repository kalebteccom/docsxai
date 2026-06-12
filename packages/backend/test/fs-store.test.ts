import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBackendStub, MemoryStore, NotFoundError, Store } from "../src/index.js";
import { FsStore } from "../src/fs-store.js";
import { RevisionFinalizedError } from "../src/store.js";

const tmpDirs: string[] = [];
function dataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-fs-store-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (ent.isFile()) out.push(path.join(ent.parentPath, ent.name));
  }
  return out;
}

describe("FsStore", () => {
  it("persists workspaces / projects / revisions across store instances", () => {
    const dir = dataDir();
    const a = new FsStore(dir);
    const ws = a.createWorkspace("acme");
    const proj = a.createProject(ws.id, "example");
    const rev1 = a.createRevision(ws.id, proj.id, "calibrate", "rowin");
    const rev2 = a.createRevision(ws.id, proj.id, "run", "rowin");

    // A fresh instance over the same dir sees everything (restart simulation).
    const b = new FsStore(dir);
    expect(b.getWorkspace(ws.id).name).toBe("acme");
    expect(b.listWorkspaces()).toHaveLength(1);
    expect(b.getProject(ws.id, proj.id).head_revision_id).toBe(rev2.id);
    expect(b.listProjects(ws.id).map((p) => p.id)).toEqual([proj.id]);
    expect(b.getRevision(ws.id, proj.id, "head").id).toBe(rev2.id);
    expect(b.getRevision(ws.id, proj.id, rev1.id).parent_revision_id).toBeNull();
    expect(b.getRevision(ws.id, proj.id, rev2.id).parent_revision_id).toBe(rev1.id);
    // newest first
    expect(b.listRevisions(ws.id, proj.id).map((r) => r.id)).toEqual([rev2.id, rev1.id]);
  });

  it("persists artifact payloads and updates the revision's artifact list", () => {
    const dir = dataDir();
    const a = new FsStore(dir);
    const ws = a.createWorkspace("w");
    const proj = a.createProject(ws.id, "p");
    const rev = a.createRevision(ws.id, proj.id, "calibrate", "x");

    const payload = { schema: "site-docs/flows@1", files: { "f.flow.yaml": "name: f\n" } };
    const updated = a.putArtifact(ws.id, proj.id, rev.id, "flows", payload);
    expect(updated.artifacts).toEqual(["flows"]);

    const b = new FsStore(dir);
    expect(b.getArtifact(ws.id, proj.id, rev.id, "flows")).toEqual(payload);
    expect(b.getRevision(ws.id, proj.id, rev.id).artifacts).toEqual(["flows"]);
    expect(() => b.getArtifact(ws.id, proj.id, rev.id, "style")).toThrow(NotFoundError);
  });

  it("persists finalization and rejects artifact PUTs on a finalized revision", () => {
    const dir = dataDir();
    const a = new FsStore(dir);
    const ws = a.createWorkspace("w");
    const proj = a.createProject(ws.id, "p");
    const rev = a.createRevision(ws.id, proj.id, "run", "x");

    expect(a.finalizeRevision(ws.id, proj.id, rev.id).finalized).toBe(true);
    expect(a.finalizeRevision(ws.id, proj.id, rev.id).finalized).toBe(true); // idempotent

    const b = new FsStore(dir);
    expect(b.getRevision(ws.id, proj.id, rev.id).finalized).toBe(true);
    expect(() => b.putArtifact(ws.id, proj.id, rev.id, "flows", {})).toThrow(
      RevisionFinalizedError,
    );
  });

  it("persists run history (newest first) and resolves rev 'head'", () => {
    const dir = dataDir();
    const a = new FsStore(dir);
    const ws = a.createWorkspace("w");
    const proj = a.createProject(ws.id, "p");
    const rev = a.createRevision(ws.id, proj.id, "run", "x");

    a.appendRun(ws.id, proj.id, { rev: "head", ok: true, duration_ms: 10, summary: "first" });
    a.appendRun(ws.id, proj.id, { rev: rev.id, ok: false, duration_ms: 20, summary: "second" });

    const b = new FsStore(dir);
    const runs = b.listRuns(ws.id, proj.id);
    expect(runs.map((r) => r.summary)).toEqual(["second", "first"]);
    expect(runs.every((r) => r.revision_id === rev.id)).toBe(true);
  });

  it("stores blobs content-addressed: dedupes, probes, reads back, 404s unknowns", () => {
    const dir = dataDir();
    const store = new FsStore(dir);
    const data = Buffer.from("png-bytes-here");
    const sha256 = createHash("sha256").update(data).digest("hex");

    expect(store.hasBlob(sha256)).toBeNull();
    expect(store.putBlob(data)).toEqual({ sha256, bytes: data.byteLength });
    expect(store.putBlob(data)).toEqual({ sha256, bytes: data.byteLength }); // idempotent
    expect(fs.readdirSync(path.join(dir, "blobs"))).toEqual([sha256]); // one file, named by hash
    expect(store.hasBlob(sha256)).toEqual({ sha256, bytes: data.byteLength });
    expect(store.getBlob(sha256)).toEqual(data);
    expect(() => store.getBlob("0".repeat(64))).toThrow(NotFoundError);
  });

  it("persists auth-cache envelopes; delete is idempotent", () => {
    const dir = dataDir();
    const a = new FsStore(dir);
    const ws = a.createWorkspace("w");
    const envelope = {
      schema: "site-docs/auth-cache@1" as const,
      alg: "aes-256-gcm" as const,
      iv: "aXY=",
      ciphertext: "Y3Q=",
      tag: "dGFn",
      expires_at: 123,
    };
    a.putAuthCache(ws.id, "editor", envelope);

    const b = new FsStore(dir);
    expect(b.getAuthCache(ws.id, "editor")).toEqual(envelope);
    b.deleteAuthCache(ws.id, "editor");
    b.deleteAuthCache(ws.id, "editor"); // idempotent
    expect(() => b.getAuthCache(ws.id, "editor")).toThrow(NotFoundError);
  });

  it("leaves no tmp files behind (atomic writes)", () => {
    const dir = dataDir();
    const store = new FsStore(dir);
    const ws = store.createWorkspace("w");
    const proj = store.createProject(ws.id, "p");
    const rev = store.createRevision(ws.id, proj.id, "calibrate", "x");
    store.putArtifact(ws.id, proj.id, rev.id, "annotations", { a: 1 });
    store.putBlob(Buffer.from("data"));
    store.appendRun(ws.id, proj.id, { rev: "head", ok: true, duration_ms: 1, summary: "s" });

    expect(listFilesRecursive(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("treats traversal-shaped ids as not-found instead of escaping the data dir", () => {
    const dir = dataDir();
    const store = new FsStore(dir);
    const ws = store.createWorkspace("w");
    const sibling = path.join(path.dirname(dir), "fs-store-escape-probe");
    fs.rmSync(sibling, { recursive: true, force: true });

    expect(() => store.getProject(ws.id, "../../escape")).toThrow(NotFoundError);
    expect(() => store.getRevision(ws.id, "../../escape", "../../../escape")).toThrow(
      NotFoundError,
    );
    // A traversal-shaped role on a write path must throw, not write outside the root.
    expect(() =>
      store.putAuthCache(ws.id, "../../../fs-store-escape-probe/x", {
        schema: "site-docs/auth-cache@1",
        alg: "aes-256-gcm",
        iv: "aXY=",
        ciphertext: "Y3Q=",
        tag: "dGFn",
      }),
    ).toThrow(/escapes backend data dir/);
    expect(fs.existsSync(sibling)).toBe(false);
  });
});

describe("createBackendStub store selection", () => {
  it("keeps the in-memory default and the Store alias", () => {
    const stub = createBackendStub();
    expect(stub.store).toBeInstanceOf(MemoryStore);
    expect(Store).toBe(MemoryStore);
  });

  it("uses FsStore when dataDir is set — data survives a server restart", async () => {
    const dir = dataDir();
    const first = createBackendStub({ token: "t", dataDir: dir });
    expect(first.store).toBeInstanceOf(FsStore);
    const base1 = await first.listen(0);
    const created = await (
      await fetch(`${base1}/v1/workspaces`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ name: "persisted" }),
      })
    ).json();
    await first.close();

    const second = createBackendStub({ token: "t", dataDir: dir });
    const base2 = await second.listen(0);
    const listed = await (
      await fetch(`${base2}/v1/workspaces`, { headers: { authorization: "Bearer t" } })
    ).json();
    await second.close();
    expect(listed).toEqual([created]);
  });

  it("honors the SITE_DOCS_DATA_DIR env var", async () => {
    const dir = dataDir();
    const prev = process.env.SITE_DOCS_DATA_DIR;
    process.env.SITE_DOCS_DATA_DIR = dir;
    try {
      const stub = createBackendStub({ token: "t" });
      expect(stub.store).toBeInstanceOf(FsStore);
      const base = await stub.listen(0);
      await fetch(`${base}/v1/workspaces`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ name: "via-env" }),
      });
      await stub.close();
      expect(fs.existsSync(path.join(dir, "workspaces.json"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SITE_DOCS_DATA_DIR;
      else process.env.SITE_DOCS_DATA_DIR = prev;
    }
  });

  it("prefers an explicitly passed store over dataDir", () => {
    const store = new MemoryStore();
    const stub = createBackendStub({ store, dataDir: dataDir() });
    expect(stub.store).toBe(store);
  });
});
