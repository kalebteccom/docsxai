// Integration test: backend client ↔ real stub server (spun up in-process per test).

import { createBackendStub } from "@kalebtec/docsxai-backend";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BackendClient, BackendClientError } from "../src/backend-client.js";
import { readDocPack, writeDocPack } from "../src/doc-pack-io.js";

let stub: Awaited<ReturnType<typeof createStubServer>>;

async function createStubServer() {
  const s = createBackendStub({ token: "test-token" });
  const url = await s.listen(0); // ephemeral port
  return { url, close: () => s.close() };
}

beforeAll(async () => {
  stub = await createStubServer();
  process.env.SITE_DOCS_TOKEN = "test-token";
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
      schema: "site-docs/flows@1" as const,
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
    const prev = process.env.SITE_DOCS_TOKEN;
    delete process.env.SITE_DOCS_TOKEN;
    expect(() => new BackendClient({ baseUrl: stub.url })).toThrow(/no bearer token/);
    process.env.SITE_DOCS_TOKEN = prev;
  });

  it("throws BackendClientError on 4xx/5xx", async () => {
    await expect(client.getWorkspace("nope-doesnt-exist")).rejects.toThrow(BackendClientError);
  });
});

describe("push round-trip (readDocPack → backend → writeDocPack)", () => {
  let workspaceSrc = "";
  let workspaceDst = "";
  beforeAll(async () => {
    workspaceSrc = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-push-src-"));
    workspaceDst = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-push-dst-"));
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
      '{"schema":"site-docs/annotations@1","flow":"f","annotations":[]}',
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "f", "screenshots", "s.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "style.yaml"),
      "schema: site-docs/style@1\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceSrc, "docs", "style.json"),
      '{"schema":"site-docs/style@1"}',
      "utf8",
    );
  });

  it("round-trips: src → backend → dst", async () => {
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

    for (const [k, p] of Object.entries(payloads)) {
      if (p === null) continue;

      await client.putArtifact(ws.id, proj.id, rev.id, k as any, p);
    }

    // Pull side: fetch each artifact and write into the dst workspace
    const meta = await client.getRevision(ws.id, proj.id, "head");
    const fetched: Partial<Awaited<ReturnType<typeof readDocPack>>> = {};
    for (const a of meta.artifacts) {
      (fetched as any)[a] = await client.getArtifact(ws.id, proj.id, "head", a);
    }
    const r = await writeDocPack(workspaceDst, fetched);
    expect(r.filesWritten).toBeGreaterThanOrEqual(4); // at least flows + annotations + screenshot + style.yaml

    // Verify content equivalence
    expect(await fs.readFile(path.join(workspaceDst, "flows", "f.flow.yaml"), "utf8")).toBe(
      await fs.readFile(path.join(workspaceSrc, "flows", "f.flow.yaml"), "utf8"),
    );
    expect(await fs.readFile(path.join(workspaceDst, "docs", "f", "screenshots", "s.png"))).toEqual(
      await fs.readFile(path.join(workspaceSrc, "docs", "f", "screenshots", "s.png")),
    );
  });
});
