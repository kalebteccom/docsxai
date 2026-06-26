// Encrypted storage-state cache relay (`BackendStateCache`). Re-exported from `./backend-client.js`.
//
// Client-side encryption: the backend stores an opaque AES-256-GCM envelope and never sees the
// plaintext session. The shapes below are structural mirrors of the engine's auth layer
// (`StorageState` / `AuthResult` / `RoleAuth.cache`) — deliberately not imported from auth.ts so
// the modules stay decoupled; the auth layer satisfies them structurally.
//
// NOTE: the ttl-to-ms / cookie-expiry math here is the same shape that also lives in
// `auth/storage-state-cache.ts` and `auth/types.ts`. The two helpers below are file-private (a
// single copy for the backend-client surface); the auth/* copies are left untouched here, so the
// shape exists in three places but each is small and within the jscpd budget.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { API_VERSION, API_VERSION_HEADER, BackendClientError } from "./backend-client-contracts.js";

export interface CachedStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface CachedAuthResult {
  storageState: CachedStorageState;
  /** Epoch ms when the session is known to expire (e.g. from a cookie's `expires`). Optional. */
  expiresAt?: number;
}

export interface CacheRoleConfig {
  cache: {
    /** `"session"`, a duration string (`30m`, `1h`, `500ms`), or ms as a number. */
    ttl: string | number;
    auth_cookie?: string;
  };
}

export class BackendStateCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendStateCacheError";
  }
}

export interface BackendStateCacheOptions {
  baseUrl: string;
  token: string;
  workspaceId: string;
  /** Base64-encoded 32-byte AES key — the resolved value of `DOCSX_CACHE_KEY`. */
  cacheKey: string;
  fetch?: typeof globalThis.fetch;
}

interface AuthCacheEnvelope {
  schema: "docsxai/auth-cache@1";
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
  expires_at?: number;
}

/** Parse a `ttl` (number ms, duration string `30m`/`1h`/`500ms`, or anything else) to ms or `"session"`. */
function ttlToMs(ttl: string | number): number | "session" {
  if (typeof ttl === "number") return ttl;
  const m = /^(\d+)(ms|s|m|h)$/.exec(ttl);
  if (!m) return "session";
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    default:
      return n * 3_600_000;
  }
}

/** Expiry (epoch ms) of the cookie named `name` — the latest if several; `undefined` if absent or session-only. */
function cookieExpiryByName(state: CachedStorageState, name: string): number | undefined {
  const expiries = state.cookies
    .filter((c) => c.name === name && typeof c.expires === "number" && c.expires > 0)
    .map((c) => c.expires * 1000);
  return expiries.length ? Math.max(...expiries) : undefined;
}

/**
 * Backend-relayed storage-state cache. Same `load` / `save` / `clear` contract as the local
 * `.auth/<role>.json` cache (incl. the expiry-priority rules), but the entry lives on the backend
 * as a client-side-encrypted envelope — usable by a team sharing one backend, opaque to the server.
 */
export class BackendStateCache {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workspaceId: string;
  private readonly key: Buffer;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(opts: BackendStateCacheOptions) {
    if (!opts.cacheKey) {
      throw new BackendStateCacheError(
        "missing cache key — set DOCSX_CACHE_KEY to a base64-encoded 32-byte key",
      );
    }
    const key = Buffer.from(opts.cacheKey, "base64");
    if (key.length !== 32) {
      throw new BackendStateCacheError(
        `malformed cache key — DOCSX_CACHE_KEY must decode to exactly 32 bytes (got ${key.length})`,
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.workspaceId = opts.workspaceId;
    this.key = key;
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  /** Return the cached state for a role if present and not past its expiry; otherwise `null`. */
  async load(role: string, now = Date.now()): Promise<CachedStorageState | null> {
    const res = await this.doFetch(this.url(role), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new BackendClientError(`GET auth-cache(${role}) → ${res.status}`, res.status);
    }
    const envelope = (await res.json()) as AuthCacheEnvelope;
    const plain = this.decrypt(envelope);
    let entry: { storageState?: CachedStorageState; expiresAt?: number };
    try {
      entry = JSON.parse(plain) as typeof entry;
    } catch {
      return null; // corrupt entry → treat as miss (mirrors the local cache)
    }
    if (!entry.storageState || typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
      return null;
    }
    return entry.storageState;
  }

  /**
   * Encrypt + store a captured session, computing its expiry exactly like the local cache:
   * auth-cookie expiry when available, else `ttl`, else the strategy-reported `expiresAt`
   * (if plausibly in the future), else +1h. Refuses to cache an already-dead session.
   */
  async save(
    role: string,
    result: CachedAuthResult,
    roleAuth: CacheRoleConfig,
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
      throw new BackendStateCacheError(
        `computed cache expiry (${new Date(expiresAt).toISOString()}, from ${source}) is not in the future — refusing to cache a dead session`,
      );
    }

    const entry = { storageState: result.storageState, writtenAt: now, expiresAt };
    const envelope: AuthCacheEnvelope = {
      ...this.encrypt(JSON.stringify(entry)),
      expires_at: expiresAt,
    };
    const res = await this.doFetch(this.url(role), {
      method: "PUT",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new BackendClientError(`PUT auth-cache(${role}) → ${res.status}`, res.status);
    }
    return { expiresAt, source };
  }

  async clear(role: string): Promise<void> {
    const res = await this.doFetch(this.url(role), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new BackendClientError(`DELETE auth-cache(${role}) → ${res.status}`, res.status);
    }
  }

  private url(role: string): string {
    return `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.workspaceId)}/auth-cache/${encodeURIComponent(role)}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      [API_VERSION_HEADER]: API_VERSION,
      ...(extra ?? {}),
    };
  }

  private encrypt(plain: string): Omit<AuthCacheEnvelope, "expires_at"> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return {
      schema: "docsxai/auth-cache@1",
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  private decrypt(envelope: AuthCacheEnvelope): string {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new BackendStateCacheError(
        "auth-cache decryption failed — wrong DOCSX_CACHE_KEY or tampered ciphertext",
      );
    }
  }
}
