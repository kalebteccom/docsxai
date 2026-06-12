import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;

const h = () => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
});

async function makeRevision(): Promise<{ wsId: string; projId: string; revId: string }> {
  const ws = (await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "w" }),
    })
  ).json()) as { id: string };
  const proj = (await (
    await fetch(`${base}/v1/workspaces/${ws.id}/projects`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "p" }),
    })
  ).json()) as { id: string };
  const rev = (await (
    await fetch(`${base}/v1/workspaces/${ws.id}/projects/${proj.id}/revisions`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ kind: "run", author: "vitest" }),
    })
  ).json()) as { id: string; finalized: boolean };
  expect(rev.finalized).toBe(false);
  return { wsId: ws.id, projId: proj.id, revId: rev.id };
}

describe("revision finalization over HTTP", () => {
  it("finalizes (idempotently), reflects it on GET, and 409s later artifact PUTs", async () => {
    const { wsId, projId, revId } = await makeRevision();
    const revUrl = `${base}/v1/workspaces/${wsId}/projects/${projId}/revisions/${revId}`;

    // An artifact PUT before finalization succeeds.
    const before = await fetch(`${revUrl}/style`, {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ schema: "site-docs/style-bundle@1", yaml: "x: y\n", json: null }),
    });
    expect(before.status).toBe(200);

    const fin1 = await fetch(`${revUrl}/finalize`, { method: "POST", headers: h() });
    expect(fin1.status).toBe(200);
    expect(((await fin1.json()) as { finalized: boolean }).finalized).toBe(true);

    const fin2 = await fetch(`${revUrl}/finalize`, { method: "POST", headers: h() });
    expect(fin2.status).toBe(200); // idempotent

    const got = (await (await fetch(revUrl, { headers: h() })).json()) as {
      finalized: boolean;
      artifacts: string[];
    };
    expect(got.finalized).toBe(true);
    expect(got.artifacts).toEqual(["style"]);

    const after = await fetch(`${revUrl}/style`, {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ schema: "site-docs/style-bundle@1", yaml: "tampered\n", json: null }),
    });
    expect(after.status).toBe(409);
    expect(((await after.json()) as { error: string }).error).toBe("revision-finalized");

    // The stored payload is unchanged, and reads still work on a finalized revision.
    const read = (await (await fetch(`${revUrl}/style`, { headers: h() })).json()) as {
      yaml: string;
    };
    expect(read.yaml).toBe("x: y\n");
  });

  it("leaves new-revision creation unaffected by a finalized head", async () => {
    const { wsId, projId, revId } = await makeRevision();
    await fetch(`${base}/v1/workspaces/${wsId}/projects/${projId}/revisions/${revId}/finalize`, {
      method: "POST",
      headers: h(),
    });
    const next = await fetch(`${base}/v1/workspaces/${wsId}/projects/${projId}/revisions`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ kind: "edit", author: "vitest" }),
    });
    expect(next.status).toBe(201);
    const rev2 = (await next.json()) as { parent_revision_id: string; finalized: boolean };
    expect(rev2.parent_revision_id).toBe(revId);
    expect(rev2.finalized).toBe(false);
  });

  it("404s finalize on an unknown revision", async () => {
    const { wsId, projId } = await makeRevision();
    const r = await fetch(
      `${base}/v1/workspaces/${wsId}/projects/${projId}/revisions/nope/finalize`,
      { method: "POST", headers: h() },
    );
    expect(r.status).toBe(404);
  });
});
