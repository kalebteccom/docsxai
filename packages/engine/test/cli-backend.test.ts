// CLI-level backend coverage: `push` (blobs + manifest + finalize), `pull` (manifest → blobs →
// files), and `login --oauth` (PKCE against a real stub, token file landing under .auth/).

import { createBackendStub } from "@docsxai/backend";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const TOKEN = "cli-test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;
let out = "";
let err = "";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

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
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DOCSX_OAUTH_AUTO_APPROVE;
});

async function scaffoldWorkspace(extraConfig: Record<string, unknown> = {}): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cli-backend-"));
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs", "f", "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify(
      {
        schema: "docsxai/workspace@1",
        backend_url: base,
        created_at: new Date().toISOString(),
        ...extraConfig,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nsteps:\n  - id: s\n    action: wait\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(ws, "docs", "f", "annotations.json"),
    '{"schema":"docsxai/annotations@1","flow":"f","annotations":[]}',
    "utf8",
  );
  await fs.writeFile(path.join(ws, "docs", "f", "screenshots", "s.png"), PNG_BYTES);
  await fs.writeFile(path.join(ws, "docs", "style.yaml"), "schema: docsxai/style@1\n", "utf8");
  return ws;
}

describe("docsxai push / pull against a real stub", () => {
  it("push uploads blobs + artifacts, finalizes, and binds the workspace; re-push skips blobs", async () => {
    const src = await scaffoldWorkspace();

    expect(await main(["push", src])).toBe(0);
    expect(out).toMatch(/screenshots — 1 blob\(s\) uploaded, 0 already on the backend/);
    expect(out).toMatch(/4 artifact slots uploaded, finalized/);

    const cfg = JSON.parse(await fs.readFile(path.join(src, ".docsxai.json"), "utf8")) as {
      backend_workspace_id?: string;
      backend_project_id?: string;
    };
    expect(cfg.backend_workspace_id).toBeTruthy();
    expect(cfg.backend_project_id).toBeTruthy();

    out = "";
    expect(await main(["push", src, "--kind", "edit", "--author", "vitest"])).toBe(0);
    expect(out).toMatch(/screenshots — 0 blob\(s\) uploaded, 1 already on the backend/);
    expect(out).toMatch(/\(edit, vitest\)/);
  });

  it("pull writes the pushed doc pack (incl. screenshot bytes) into a fresh workspace", async () => {
    const src = await scaffoldWorkspace();
    expect(await main(["push", src])).toBe(0);
    const cfg = JSON.parse(await fs.readFile(path.join(src, ".docsxai.json"), "utf8")) as Record<
      string,
      unknown
    >;

    const dst = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cli-pull-"));
    await fs.writeFile(
      path.join(dst, ".docsxai.json"),
      JSON.stringify(cfg, null, 2) + "\n",
      "utf8",
    );
    out = "";
    expect(await main(["pull", dst])).toBe(0);
    expect(out).toMatch(/wrote \d+ file\(s\)/);

    expect(await fs.readFile(path.join(dst, "flows", "f.flow.yaml"), "utf8")).toBe(
      await fs.readFile(path.join(src, "flows", "f.flow.yaml"), "utf8"),
    );
    expect(await fs.readFile(path.join(dst, "docs", "f", "screenshots", "s.png"))).toEqual(
      PNG_BYTES,
    );
    expect(await fs.readFile(path.join(dst, "docs", "style.yaml"), "utf8")).toBe(
      "schema: docsxai/style@1\n",
    );
  });

  it("push exits 2 without a backend_url and pull exits 2 without a binding", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cli-unbound-"));
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({ schema: "docsxai/workspace@1", created_at: "now" }) + "\n",
      "utf8",
    );
    expect(await main(["push", ws])).toBe(2);
    expect(err).toMatch(/no backend_url/);
    err = "";
    expect(await main(["pull", ws])).toBe(2);
    expect(err).toMatch(/isn't bound to a backend/);
  });
});

describe("docsxai login --oauth", () => {
  it("runs the PKCE flow end-to-end and stores tokens at .auth/backend-token.json (0600)", async () => {
    process.env.DOCSX_OAUTH_AUTO_APPROVE = "1";
    const prevToken = process.env.DOCSX_TOKEN;
    delete process.env.DOCSX_TOKEN; // the OAuth path must not depend on the CI token
    try {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cli-oauth-"));
      // The stdout spy doubles as the "browser": fetch the authorize URL as soon as it's printed.
      vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
        const s = String(chunk);
        out += s;
        const m = /(http:\/\/\S+\/v1\/oauth\/authorize\S+)/.exec(s);
        if (m) void fetch(m[1]!);
        return true;
      });

      expect(await main(["login", "--backend-url", base, "--oauth", ws])).toBe(0);
      expect(out).toMatch(/tokens stored at/);

      const tokenPath = path.join(ws, ".auth", "backend-token.json");
      const stat = await fs.stat(tokenPath);
      expect((stat.mode & 0o777).toString(8)).toBe("600");
      const tokens = JSON.parse(await fs.readFile(tokenPath, "utf8")) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.expires_at).toBeGreaterThan(Date.now());
    } finally {
      if (prevToken !== undefined) process.env.DOCSX_TOKEN = prevToken;
    }
  });

  it("exits 2 when --oauth is passed without a workspace dir", async () => {
    expect(await main(["login", "--backend-url", base, "--oauth"])).toBe(2);
    expect(err).toMatch(/--oauth requires a <workspace-dir>/);
  });
});
