// OAuth token plumbing: stored-token file, resolution precedence, refresh rotation, the PKCE
// login helper, and run-history recording — all against a real stub server.

import { createBackendStub } from "@kalebtec/docsxai-backend";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BackendClient,
  type BackendTokenFile,
  loadBackendTokenFile,
  oauthLogin,
  recordRunHistory,
  resolveBackendToken,
  saveBackendTokenFile,
} from "../src/backend-client.js";

const TOKEN = "ci-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  savedEnv.SITE_DOCS_TOKEN = process.env.SITE_DOCS_TOKEN;
  savedEnv.SITE_DOCS_OAUTH_AUTO_APPROVE = process.env.SITE_DOCS_OAUTH_AUTO_APPROVE;
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterEach(() => {
  delete process.env.SITE_DOCS_TOKEN;
  delete process.env.SITE_DOCS_OAUTH_AUTO_APPROVE;
});

async function tmpWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "site-docs-token-"));
}

/** Drive the full PKCE handshake; the "browser" is a fetch of the printed authorize URL. */
async function loginViaAutoApprove(): Promise<BackendTokenFile> {
  process.env.SITE_DOCS_OAUTH_AUTO_APPROVE = "1";
  return oauthLogin({
    backendUrl: base,
    onAuthorizeUrl: (url) => {
      void fetch(url);
    },
  });
}

describe("backend token file", () => {
  it("saves under .auth/ with mode 0600 and round-trips", async () => {
    const ws = await tmpWorkspace();
    const tokens: BackendTokenFile = {
      access_token: "a",
      refresh_token: "r",
      expires_at: 1234567890,
    };
    const target = await saveBackendTokenFile(ws, tokens);
    expect(target).toBe(path.join(ws, ".auth", "backend-token.json"));
    const stat = await fs.stat(target);
    expect((stat.mode & 0o777).toString(8)).toBe("600");
    expect(await loadBackendTokenFile(ws)).toEqual(tokens);
  });

  it("treats a missing or corrupt token file as absent", async () => {
    const ws = await tmpWorkspace();
    expect(await loadBackendTokenFile(ws)).toBeNull();
    await fs.mkdir(path.join(ws, ".auth"), { recursive: true });
    await fs.writeFile(path.join(ws, ".auth", "backend-token.json"), "not json", "utf8");
    expect(await loadBackendTokenFile(ws)).toBeNull();
    await fs.writeFile(
      path.join(ws, ".auth", "backend-token.json"),
      JSON.stringify({ access_token: "a" }),
      "utf8",
    );
    expect(await loadBackendTokenFile(ws)).toBeNull();
  });
});

describe("resolveBackendToken precedence", () => {
  it("explicit option wins over the env var", async () => {
    process.env.SITE_DOCS_TOKEN = "from-env";
    expect(await resolveBackendToken({ baseUrl: base, token: "explicit" })).toBe("explicit");
  });

  it("env var wins over the stored token file", async () => {
    const ws = await tmpWorkspace();
    await saveBackendTokenFile(ws, {
      access_token: "from-file",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
    });
    process.env.SITE_DOCS_TOKEN = "from-env";
    expect(await resolveBackendToken({ baseUrl: base, workspaceDir: ws })).toBe("from-env");
  });

  it("falls back to a live stored token without touching the network", async () => {
    const ws = await tmpWorkspace();
    await saveBackendTokenFile(ws, {
      access_token: "from-file",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
    });
    const noNetwork = (() => {
      throw new Error("network must not be touched for a live token");
    }) as unknown as typeof fetch;
    expect(await resolveBackendToken({ baseUrl: base, workspaceDir: ws, fetch: noNetwork })).toBe(
      "from-file",
    );
  });

  it("throws a re-login hint when no token source exists", async () => {
    const ws = await tmpWorkspace();
    await expect(resolveBackendToken({ baseUrl: base, workspaceDir: ws })).rejects.toThrow(
      /site-docs login .*--oauth/,
    );
    await expect(resolveBackendToken({ baseUrl: base })).rejects.toThrow(/SITE_DOCS_TOKEN/);
  });
});

describe("oauthLogin + refresh-on-expiry", () => {
  it("completes the PKCE handshake and the access token authorizes API calls", async () => {
    const tokens = await loginViaAutoApprove();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.expires_at).toBeGreaterThan(Date.now());

    const client = new BackendClient({ baseUrl: base, token: tokens.access_token });
    expect(await client.listWorkspaces()).toBeInstanceOf(Array);
  });

  it("refreshes an expired stored token, rotating the file contents", async () => {
    const tokens = await loginViaAutoApprove();
    const ws = await tmpWorkspace();
    await saveBackendTokenFile(ws, { ...tokens, expires_at: Date.now() - 1000 });

    const resolved = await resolveBackendToken({ baseUrl: base, workspaceDir: ws });
    expect(resolved).not.toBe(tokens.access_token);

    const rewritten = await loadBackendTokenFile(ws);
    expect(rewritten!.access_token).toBe(resolved);
    expect(rewritten!.refresh_token).not.toBe(tokens.refresh_token);
    expect(rewritten!.expires_at).toBeGreaterThan(Date.now());

    // The refreshed access token is live.
    const client = new BackendClient({ baseUrl: base, token: resolved });
    expect(await client.listWorkspaces()).toBeInstanceOf(Array);
  });

  it("surfaces a refresh failure with the re-login hint", async () => {
    const ws = await tmpWorkspace();
    await saveBackendTokenFile(ws, {
      access_token: "stale",
      refresh_token: "bogus-refresh-token",
      expires_at: Date.now() - 1000,
    });
    await expect(resolveBackendToken({ baseUrl: base, workspaceDir: ws })).rejects.toThrow(
      /refresh failed.*site-docs login/,
    );
  });

  it("times out cleanly when the redirect never arrives", async () => {
    await expect(
      oauthLogin({ backendUrl: base, onAuthorizeUrl: () => undefined, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("recordRunHistory", () => {
  it("is a silent no-op for a workspace with no backend binding", async () => {
    const ws = await tmpWorkspace();
    const r = await recordRunHistory({
      workspaceDir: ws,
      config: {},
      ok: true,
      durationMs: 10,
      summary: "1/1 flows ok",
    });
    expect(r).toEqual({ recorded: false });
  });

  it("appends a run record for a bound workspace", async () => {
    process.env.SITE_DOCS_TOKEN = TOKEN;
    const client = new BackendClient({ baseUrl: base, token: TOKEN });
    const bws = await client.createWorkspace("run-history-ws");
    const proj = await client.createProject(bws.id, "p");
    await client.createRevision(bws.id, proj.id, { kind: "calibrate", author: "vitest" });

    const ws = await tmpWorkspace();
    const r = await recordRunHistory({
      workspaceDir: ws,
      config: {
        backend_url: base,
        backend_workspace_id: bws.id,
        backend_project_id: proj.id,
      },
      ok: true,
      durationMs: 4321,
      summary: "2/3 flows ok",
    });
    expect(r).toEqual({ recorded: true });

    const runs = await client.listRuns(bws.id, proj.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: true, duration_ms: 4321, summary: "2/3 flows ok" });
  });

  it("returns a warning instead of throwing when the backend is unreachable", async () => {
    process.env.SITE_DOCS_TOKEN = TOKEN;
    const ws = await tmpWorkspace();
    const r = await recordRunHistory({
      workspaceDir: ws,
      config: {
        backend_url: "http://127.0.0.1:1",
        backend_workspace_id: "w",
        backend_project_id: "p",
      },
      ok: false,
      durationMs: 1,
      summary: "0/1 flows ok",
    });
    expect(r.recorded).toBe(false);
    expect(r.warning).toMatch(/failed to record run history/);
  });
});
