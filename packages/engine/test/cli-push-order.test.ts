// `push` reads the local doc pack before it opens a revision on the backend, so a pack it cannot
// read leaves no unfinalized revision behind.

import { createBackendStub } from "@docsxai/backend";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendClient } from "../src/backend-client.js";
import { main } from "../src/cli.js";

const TOKEN = "push-order-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;
let err = "";

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  process.env.DOCSX_TOKEN = TOKEN;
});
afterAll(async () => {
  await stub.close();
  delete process.env.DOCSX_TOKEN;
});
beforeEach(() => {
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function workspace(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-push-order-"));
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify({
      schema: "docsxai/workspace@1",
      backend_url: base,
      created_at: new Date().toISOString(),
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nsteps:\n  - id: s\n    action: wait\n",
    "utf8",
  );
  return ws;
}

describe("push with a doc pack it cannot read", () => {
  it("exits 1 naming the file and leaves the backend without a new revision", async () => {
    const ws = await workspace();
    expect(await main(["push", ws])).toBe(0);
    const cfg = JSON.parse(await fs.readFile(path.join(ws, ".docsxai.json"), "utf8")) as {
      backend_workspace_id: string;
      backend_project_id: string;
    };
    const client = new BackendClient({ baseUrl: base, token: TOKEN });
    const before = await client.listRevisions(cfg.backend_workspace_id, cfg.backend_project_id);

    await fs.writeFile(path.join(ws, "docs", "style.json"), "{ not json", "utf8");
    expect(await main(["push", ws])).toBe(1);
    expect(err).toContain("style.json");

    const after = await client.listRevisions(cfg.backend_workspace_id, cfg.backend_project_id);
    expect(after.length).toBe(before.length);
  });

  it("does not bind a first push to a workspace on the backend", async () => {
    const ws = await workspace();
    await fs.writeFile(path.join(ws, "docs", "style.json"), "{ not json", "utf8");
    expect(await main(["push", ws])).toBe(1);
    const cfg = JSON.parse(await fs.readFile(path.join(ws, ".docsxai.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(cfg.backend_workspace_id).toBeUndefined();
  });
});
