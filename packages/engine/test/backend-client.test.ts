// Integration test: backend client ↔ real stub server (spun up in-process per test).

import { createBackendStub } from "@docsxai/backend";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BackendClient, BackendClientError } from "../src/backend-client.js";
import {
  fetchScreenshotBlobs,
  readDocPack,
  uploadScreenshotBlobs,
  writeDocPack,
} from "../src/doc-pack-io.js";

let stub: Awaited<ReturnType<typeof createStubServer>>;

async function createStubServer() {
  const s = createBackendStub({ token: "test-token" });
  const url = await s.listen(0); // ephemeral port
  return { url, close: () => s.close() };
}

beforeAll(async () => {
  stub = await createStubServer();
  process.env.DOCSX_TOKEN = "test-token";
});
afterAll(async () => {
  await stub.close();
});

describe("BackendClient ↔ stub server", () => {
  let client: BackendClient;
  beforeEach(() => {
    client = new BackendClient({ baseUrl: stub.url });
  });

  it("health()", async () => {
    const h = await client.health();
    expect(h.ok).toBe(true);
  });

  it("creates a workspace + project + revision; pushes an artifact and reads it back", async () => {
    const ws = await client.createWorkspace("test-ws");
    expect(ws.id).toBeTruthy();
    const proj = await client.createProject(ws.id, "test-proj");
    expect(proj.head_revision_id).toBeNull();

    const rev = await client.createRevision(ws.id, proj.id, {
      kind: "calibrate",
      author: "vitest",
    });
    expect(rev.id).toBeTruthy();
    expect(rev.kind).toBe("calibrate");

    const payload = {
      schema: "docsxai/flows@1" as const,
      files: { "f.flow.yaml": "name: f\nsteps:\n  - id: s\n    action: wait\n" },
    };
    await client.putArtifact(ws.id, proj.id, rev.id, "flows", payload);
    const fetched = await client.getArtifact(ws.id, proj.id, rev.id, "flows");
    expect(fetched).toEqual(payload);

    // listRevisions includes the one we made; project's head should now be that rev
    const list = await client.listRevisions(ws.id, proj.id);
    expect(list.some((r) => r.id === rev.id)).toBe(true);
    const projAfter = await client.getProject(ws.id, proj.id);
    expect(projAfter.head_revision_id).toBe(rev.id);
  });

  it("throws BackendClientError on missing token", () => {
    const prev = process.env.DOCSX_TOKEN;
    delete process.env.DOCSX_TOKEN;
    expect(() => new BackendClient({ baseUrl: stub.url })).toThrow(/no bearer token/);
    process.env.DOCSX_TOKEN = prev;
  });

  it("throws BackendClientError on 4xx/5xx", async () => {
    await expect(client.getWorkspace("nope-doesnt-exist")).rejects.toThrow(BackendClientError);
  });

  it("round-trips content-addressed blobs (put / has / get)", async () => {
    const data = Buffer.from("blob-payload-bytes");
    const expectedSha = createHash("sha256").update(data).digest("hex");

    expect(await client.hasBlob(expectedSha)).toBe(false);
    const ref = await client.putBlob(data);
    expect(ref).toEqual({ sha256: expectedSha, bytes: data.byteLength });
    expect(await client.hasBlob(expectedSha)).toBe(true);
    expect(Buffer.from(await client.getBlob(expectedSha))).toEqual(data);

    // idempotent re-put
    const again = await client.putBlob(data);
    expect(again.sha256).toBe(expectedSha);
  });

  it("finalizes a revision: idempotent, visible on GET, and artifact PUTs 409 afterwards", async () => {
    const ws = await client.createWorkspace("finalize-ws");
    const proj = await client.createProject(ws.id, "finalize-proj");
    const rev = await client.createRevision(ws.id, proj.id, { kind: "run", author: "vitest" });
    expect(rev.finalized).toBe(false);

    await client.putArtifact(ws.id, proj.id, rev.id, "locators", {
      schema: "docsxai/locators@1",
      yaml: "a: b\n",
    });
    const finalized = await client.finalizeRevision(ws.id, proj.id, rev.id);
    expect(finalized.finalized).toBe(true);
    // idempotent
    expect((await client.finalizeRevision(ws.id, proj.id, rev.id)).finalized).toBe(true);
    expect((await client.getRevision(ws.id, proj.id, rev.id)).finalized).toBe(true);

    let err: BackendClientError | undefined;
    try {
      await client.putArtifact(ws.id, proj.id, rev.id, "locators", { yaml: "tampered\n" });
    } catch (e) {
      err = e as BackendClientError;
    }
    expect(err).toBeInstanceOf(BackendClientError);
    expect(err!.status).toBe(409);
    expect((err!.body as { error: string }).error).toBe("revision-finalized");

    // artifacts already uploaded stay readable; new revisions are unaffected
    expect(await client.getArtifact(ws.id, proj.id, rev.id, "locators")).toMatchObject({
      yaml: "a: b\n",
    });
    const rev2 = await client.createRevision(ws.id, proj.id, { kind: "edit", author: "vitest" });
    expect(rev2.finalized).toBe(false);
  });

  it("appends and lists run-history records", async () => {
    const ws = await client.createWorkspace("runs-ws");
    const proj = await client.createProject(ws.id, "runs-proj");
    const rev = await client.createRevision(ws.id, proj.id, { kind: "calibrate", author: "v" });

    const rec = await client.appendRun(ws.id, proj.id, {
      rev: "head",
      ok: true,
      duration_ms: 1500,
      summary: "2/2 flows ok",
    });
    expect(rec.revision_id).toBe(rev.id);

    await client.appendRun(ws.id, proj.id, {
      rev: rev.id,
      ok: false,
      duration_ms: 900,
      summary: "0/2 flows ok",
    });
    const runs = await client.listRuns(ws.id, proj.id);
    expect(runs).toHaveLength(2);
    // newest first
    expect(runs[0]!.summary).toBe("0/2 flows ok");
    expect(runs[1]!.summary).toBe("2/2 flows ok");
  });
});

describe("push round-trip (readDocPack → backend → writeDocPack)", () => {
  let workspaceSrc = "";
  let workspaceDst = "";
  beforeAll(async () => {
    workspaceSrc = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-push-src-"));
    workspaceDst = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-push-dst-"));
    // Populate src with a minimal doc pack.
    await fs.mkdir(path.join(workspaceSrc, "flows"), { recursive: true });
    await fs.mkdir(path.join(workspaceSrc, "docs", "f"), { recursive: true });
    await fs.mkdir(path.join(workspaceSrc, "docs", "f", "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceSrc, "flows", "f.flow.yaml"),
      "name: f\nsteps:\n  - id: s\n    action: wait\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "f", "annotations.json"),
      '{"schema":"docsxai/annotations@1","flow":"f","annotations":[]}',
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "f", "screenshots", "s.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "style.yaml"),
      "schema: docsxai/style@1\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "style.json"),
      '{"schema":"docsxai/style@1"}',
      "utf8",
    );
  });

  it("round-trips: src → backend (blobs + manifest) → dst", async () => {
    const client = new BackendClient({ baseUrl: stub.url });
    const ws = await client.createWorkspace("round-trip-ws");
    const proj = await client.createProject(ws.id, "round-trip-proj");
    const rev = await client.createRevision(ws.id, proj.id, {
      kind: "calibrate",
      author: "vitest",
    });

    const payloads = await readDocPack(workspaceSrc);
    expect(payloads.flows).not.toBeNull();
    expect(payloads.annotations).not.toBeNull();
    expect(payloads.screenshots).not.toBeNull();
    expect(payloads.style).not.toBeNull();

    // The screenshots payload is a sha256 manifest, not base64 bytes.
    const srcPng = await fs.readFile(path.join(workspaceSrc, "docs", "f", "screenshots", "s.png"));
    expect(payloads.screenshots!.schema).toBe("docsxai/screenshots@2");
    expect(payloads.screenshots!.files["f/screenshots/s.png"]).toEqual({
      sha256: createHash("sha256").update(srcPng).digest("hex"),
      bytes: srcPng.byteLength,
    });

    const first = await uploadScreenshotBlobs(workspaceSrc, payloads.screenshots!, client);
    expect(first).toEqual({ uploaded: 1, skipped: 0 });
    // Second pass HEAD-probes and skips everything already on the backend.
    const second = await uploadScreenshotBlobs(workspaceSrc, payloads.screenshots!, client);
    expect(second).toEqual({ uploaded: 0, skipped: 1 });

    for (const [k, p] of Object.entries(payloads)) {
      if (p === null) continue;

      await client.putArtifact(ws.id, proj.id, rev.id, k as any, p);
    }
    await client.finalizeRevision(ws.id, proj.id, rev.id);

    // Pull side: fetch each artifact, then the blobs behind the manifest, and write into dst.
    const meta = await client.getRevision(ws.id, proj.id, "head");
    expect(meta.finalized).toBe(true);
    const fetched: Partial<Awaited<ReturnType<typeof readDocPack>>> = {};
    for (const a of meta.artifacts) {
      (fetched as any)[a] = await client.getArtifact(ws.id, proj.id, "head", a);
    }
    const screenshotBytes = await fetchScreenshotBlobs(fetched.screenshots!, client);
    const r = await writeDocPack(workspaceDst, fetched, { screenshotBytes });
    expect(r.filesWritten).toBeGreaterThanOrEqual(4); // at least flows + annotations + screenshot + style.yaml

    // Verify content equivalence
    expect(await fs.readFile(path.join(workspaceDst, "flows", "f.flow.yaml"), "utf8")).toBe(
      await fs.readFile(path.join(workspaceSrc, "flows", "f.flow.yaml"), "utf8"),
    );
    expect(await fs.readFile(path.join(workspaceDst, "docs", "f", "screenshots", "s.png"))).toEqual(
      srcPng,
    );
  });
});
