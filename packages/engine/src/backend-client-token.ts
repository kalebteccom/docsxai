// Bearer-token resolution for backend calls: the stored OAuth token file (`.auth/backend-token.json`),
// the resolution precedence (explicit → `DOCSX_TOKEN` → stored, with refresh-rotation), and the
// load/save helpers. Re-exported from `./backend-client.js`.

import { promises as fs } from "node:fs";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";
import { BackendClientError, type BackendTokenFile } from "./backend-client-contracts.js";

const BACKEND_TOKEN_FILE = "backend-token.json";

export async function loadBackendTokenFile(workspaceDir: string): Promise<BackendTokenFile | null> {
  let text: string;
  try {
    text = await fs.readFile(
      resolveWorkspacePath(workspaceDir, ".auth", BACKEND_TOKEN_FILE),
      "utf8",
    );
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<BackendTokenFile>;
    if (
      typeof parsed.access_token === "string" &&
      typeof parsed.refresh_token === "string" &&
      typeof parsed.expires_at === "number"
    ) {
      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: parsed.expires_at,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist OAuth tokens under the workspace's `.auth/` (operator-local; gitignored), mode 0600. */
export async function saveBackendTokenFile(
  workspaceDir: string,
  tokens: BackendTokenFile,
): Promise<string> {
  await fs.mkdir(resolveWorkspacePath(workspaceDir, ".auth"), { recursive: true });
  const target = await resolveWorkspacePathReal(workspaceDir, ".auth", BACKEND_TOKEN_FILE);
  await fs.writeFile(target, JSON.stringify(tokens, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(target, 0o600);
  return target;
}

/**
 * Resolve the bearer token for a backend call, in priority order:
 *   1. the explicit `token` option,
 *   2. the `DOCSX_TOKEN` env var (the CI path),
 *   3. the workspace's stored OAuth tokens (`.auth/backend-token.json`), refreshing them against
 *      the backend when expired (rotated tokens are written back to the file).
 */
export async function resolveBackendToken(opts: {
  baseUrl: string;
  token?: string;
  workspaceDir?: string;
  fetch?: typeof globalThis.fetch;
  now?: number;
}): Promise<string> {
  if (opts.token) return opts.token;
  if (process.env.DOCSX_TOKEN) return process.env.DOCSX_TOKEN;
  const reloginHint = `set DOCSX_TOKEN or run \`docsxai login --backend-url ${opts.baseUrl} --oauth <workspace-dir>\``;
  if (!opts.workspaceDir) {
    throw new BackendClientError(`no bearer token — ${reloginHint}`);
  }
  const stored = await loadBackendTokenFile(opts.workspaceDir);
  if (!stored) {
    throw new BackendClientError(`no bearer token — ${reloginHint}`);
  }
  const now = opts.now ?? Date.now();
  if (stored.expires_at > now + 30_000) return stored.access_token;
  // Expired (or about to) — attempt a refresh-token rotation.
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  let refreshed: { access_token: string; refresh_token: string; expires_in: number };
  try {
    const res = await doFetch(`${base}/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      }).toString(),
    });
    if (!res.ok) throw new BackendClientError(`token refresh → ${res.status}`, res.status);
    refreshed = (await res.json()) as typeof refreshed;
  } catch (e) {
    throw new BackendClientError(
      `stored backend token expired and the refresh failed (${(e as Error).message}) — ${reloginHint}`,
    );
  }
  const tokens: BackendTokenFile = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: now + refreshed.expires_in * 1000,
  };
  await saveBackendTokenFile(opts.workspaceDir, tokens);
  return tokens.access_token;
}
