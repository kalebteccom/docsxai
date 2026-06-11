// Shared auth-layer types and StorageState helpers.
//
// Every strategy produces a `storageState` (cookies + localStorage + sessionStorage) — the
// universal artifact every auth scheme reduces to. Execution consumes it via Playwright's
// `setup`-project + `dependencies` mechanism (auth-agnostic for the rest of the suite).

/** Structural shape of Playwright's `BrowserContext.storageState()` output. We don't import Playwright here. */
export interface StorageState {
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

/** One captured cookie in a {@link StorageState} jar. */
export type StorageStateCookie = StorageState["cookies"][number];

/** An empty jar — for strategies whose "auth" is connection-level, not storage-level. */
export function emptyStorageState(): StorageState {
  return { cookies: [], origins: [] };
}

/**
 * Connection-level auth a strategy asks the browser context to carry. Produced by strategies whose
 * scheme isn't reducible to cookies/localStorage (HTTP Basic, PAT headers, mTLS client certs).
 * The session launcher passes these through to Playwright's `browser.newContext(...)`.
 */
export interface AuthContextOptions {
  httpCredentials?: { username: string; password: string };
  clientCertificates?: Array<Record<string, unknown>>;
  extraHTTPHeaders?: Record<string, string>;
}

/** Result of authenticating a role: the captured session, plus an optional hard expiry the strategy knows. */
export interface AuthResult {
  storageState: StorageState;
  /** Epoch ms when the session is known to expire (e.g. from a cookie's `expires`). Optional. */
  expiresAt?: number;
  /** Connection-level auth (HTTP Basic / client certs / extra headers) for the browser context. */
  contextOptions?: AuthContextOptions;
}

export interface AuthContext {
  /** Credential values, resolved from the role's `creds_env` name map. Empty for `manual-capture`. */
  creds: Record<string, string>;
  /** Strategy-specific options from the descriptor. */
  options: Record<string, unknown>;
  /** The target site's base URL. */
  baseURL: string;
  /** Role name (for logging / cache keying). */
  role: string;
  /** Workspace root, for strategies that need workspace-rooted IO. Optional. */
  workspaceDir?: string;
  /** Parallel-worker index, for credential pools. Default 0. */
  workerIndex?: number;
}

/**
 * A strategy: given an {@link AuthContext}, produce an {@link AuthResult}. One implementation per
 * backend type. `name` matches the descriptor's `strategy` value for built-ins; registry-registered
 * plugin strategies may omit it (the registration name is canonical).
 */
export interface AuthStrategy {
  readonly name?: string;
  authenticate(ctx: AuthContext): Promise<AuthResult>;
}

export class NotImplementedStrategyError extends Error {
  constructor(name: string) {
    super(`auth strategy "${name}" is not implemented in this build`);
    this.name = "NotImplementedStrategyError";
  }
}

export class AuthStrategyConfigError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AuthStrategyConfigError";
  }
}

/** Mask a secret for logs / error messages — the value itself must never surface. */
export function maskSecret(value: string | undefined): "<SET>" | "<UNSET>" {
  return value ? "<SET>" : "<UNSET>";
}

/** Render a `{{key}}` template against a variable map. Unknown keys are left intact. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key]! : whole,
  );
}

/** The earliest non-session cookie expiry (epoch ms), or `undefined` if all cookies are session cookies. */
export function earliestCookieExpiry(state: StorageState): number | undefined {
  const expiries = state.cookies
    .map((c) => c.expires)
    .filter((e) => typeof e === "number" && e > 0)
    .map((e) => e * 1000); // Playwright cookie `expires` is seconds since epoch (or -1 for session)
  return expiries.length ? Math.min(...expiries) : undefined;
}

/** Expiry (epoch ms) of the cookie named `name` in `state` — the latest if there are several; `undefined` if absent or a session cookie (`expires <= 0`). */
export function cookieExpiryByName(state: StorageState, name: string): number | undefined {
  const expiries = state.cookies
    .filter((c) => c.name === name && typeof c.expires === "number" && c.expires > 0)
    .map((c) => c.expires * 1000);
  return expiries.length ? Math.max(...expiries) : undefined;
}
