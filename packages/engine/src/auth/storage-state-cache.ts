// Local storageState cache (`.auth/<role>.json`) — used by expensive strategies (manual-capture, ui-form, ...).

import { promises as fs } from "node:fs";
import { z } from "zod";
import { BackendStateCache, resolveBackendToken } from "../backend-client.js";
import { type RoleAuth } from "../doc-pack.js";
import {
  loadWorkspaceConfig,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
} from "../workspace.js";
import {
  AuthStrategyConfigError,
  cookieExpiryByName,
  type AuthResult,
  type StorageState,
} from "./types.js";

interface CachedState {
  storageState: StorageState;
  /** Epoch ms the cache entry was written. */
  writtenAt: number;
  /** Epoch ms the session expires (from the strategy or computed from `ttl`). */
  expiresAt: number;
}

const CachedStateSchema = z
  .object({
    storageState: z.object({ cookies: z.array(z.any()), origins: z.array(z.any()) }),
    writtenAt: z.number(),
    expiresAt: z.number(),
  })
  .passthrough();

function ttlToMs(ttl: RoleAuth["cache"]["ttl"]): number | "session" {
  if (ttl === "session") return "session";
  if (typeof ttl === "number") return ttl;
  const m = /^(\d+)(ms|s|m|h)$/.exec(ttl)!;
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return n;
  }
}

export class LocalStorageStateCache {
  /** @param dir the `.auth/` directory (relative paths resolved against cwd). */
  constructor(private readonly dir = ".auth") {}

  private fileName(role: string): string {
    // role names are simple identifiers in practice; still, keep the filename safe.
    const safe = role.replace(/[^A-Za-z0-9_.-]/g, "_");
    return `${safe}.json`;
  }

  private file(role: string): string {
    return resolveWorkspacePath(this.dir, this.fileName(role));
  }

  /** Return the cached state for a role if present and not past its expiry; otherwise `null`. */
  async load(role: string, now = Date.now()): Promise<StorageState | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file(role), "utf8");
    } catch {
      return null;
    }
    let parsed: CachedState;
    try {
      parsed = CachedStateSchema.parse(JSON.parse(text));
    } catch {
      return null; // corrupt cache → treat as miss
    }
    if (parsed.expiresAt <= now) return null;
    return parsed.storageState;
  }

  /**
   * Persist a captured session and compute its expiry, in priority order:
   *   1. **The app's auth cookie** — if `auth_cookie` (descriptor or override) names a cookie that's in the
   *      captured jar with a real (non-session) expiry, that expiry *is* the bound. This is the right answer;
   *      the host agent identifies which cookie it is (it's on the app's domain, long-lived — not an ephemeral
   *      IdP scratch cookie). Why not just `min(cookie.expires)`? An interactive SSO login drops scratch cookies
   *      that expire seconds out, so the min ≈ now and the session would be born expired.
   *   2. **`ttl`** — a duration (`1h`, `30m`, ms) → `now + ttl`. The fallback when no `auth_cookie` is set/found.
   *   3. **`session` / default** — the strategy's reported `expiresAt` if plausibly in the future, else +1h.
   * Returns the computed `expiresAt` and a human-readable `source`.
   */
  async save(
    role: string,
    result: AuthResult,
    roleAuth: RoleAuth,
    now = Date.now(),
    opts: { authCookie?: string } = {},
  ): Promise<{ expiresAt: number; source: string }> {
    const authCookieName = opts.authCookie ?? roleAuth.cache.auth_cookie;
    const fromCookie = authCookieName
      ? cookieExpiryByName(result.storageState, authCookieName)
      : undefined;
    const ttlMs = ttlToMs(roleAuth.cache.ttl);

    let expiresAt: number;
    let source: string;
    if (fromCookie !== undefined) {
      expiresAt = fromCookie;
      source = `auth-cookie "${authCookieName}"`;
    } else if (authCookieName) {
      expiresAt = typeof ttlMs === "number" ? now + ttlMs : now + 3_600_000;
      source = `ttl (fallback — auth-cookie "${authCookieName}" not in the jar or has no expiry)`;
    } else if (typeof ttlMs === "number") {
      expiresAt = now + ttlMs;
      source = "ttl";
    } else {
      const reported =
        result.expiresAt && result.expiresAt > now + 60_000 ? result.expiresAt : undefined;
      expiresAt = reported ?? now + 3_600_000;
      source = reported ? "strategy-reported expiresAt" : "1h default";
    }
    if (expiresAt <= now) {
      throw new AuthStrategyConfigError(
        `computed cache expiry (${new Date(expiresAt).toISOString()}, from ${source}) is not in the future — refusing to cache a dead session`,
      );
    }
    const entry: CachedState = { storageState: result.storageState, writtenAt: now, expiresAt };
    await fs.mkdir(resolveWorkspacePath(this.dir), { recursive: true });
    // Role names are operator-influenced — resolve with the symlink-aware variant before writing.
    const target = await resolveWorkspacePathReal(this.dir, this.fileName(role));
    await fs.writeFile(target, JSON.stringify(entry, null, 2) + "\n", "utf8");
    return { expiresAt, source };
  }

  async clear(role: string): Promise<void> {
    await fs.rm(this.file(role), { force: true });
  }
}

/** The cache surface both stores satisfy — `load` / `save` / `clear` per role. */
export type StorageStateCache = Pick<LocalStorageStateCache, "load" | "save" | "clear">;

/**
 * Pick the state cache for a role. `store: local` (the default) caches under `<workspace>/.auth/`.
 * `store: backend` relays AES-256-GCM envelopes through the backend (encrypted client-side; the
 * backend never sees plaintext) — it needs a workspace that has been pushed (`backend_url` +
 * `backend_workspace_id` in `.docsxai.json`) and `DOCSX_CACHE_KEY`.
 */
export async function resolveStateCache(
  roleAuth: RoleAuth,
  workspaceDir: string,
): Promise<StorageStateCache> {
  if (roleAuth.cache.store === "backend") {
    const cfg = await loadWorkspaceConfig(workspaceDir);
    if (!cfg?.backend_url || !cfg.backend_workspace_id) {
      throw new AuthStrategyConfigError(
        "cache.store: backend needs a backend-bound workspace — run `docsxai push` first (backend_url + backend_workspace_id in .docsxai.json)",
      );
    }
    const cacheKey = process.env.DOCSX_CACHE_KEY;
    if (!cacheKey) {
      throw new AuthStrategyConfigError(
        "cache.store: backend requires DOCSX_CACHE_KEY (base64-encoded 32-byte key)",
      );
    }
    const token = await resolveBackendToken({ baseUrl: cfg.backend_url, workspaceDir });
    return new BackendStateCache({
      baseUrl: cfg.backend_url,
      token,
      workspaceId: cfg.backend_workspace_id,
      cacheKey,
    });
  }
  return new LocalStorageStateCache(resolveWorkspacePath(workspaceDir, ".auth"));
}
