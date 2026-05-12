// Target-site auth layer.
//
// Every strategy produces a `storageState` (cookies + localStorage + sessionStorage) — the
// universal artifact every auth scheme reduces to. Execution consumes it via Playwright's
// `setup`-project + `dependencies` mechanism (auth-agnostic for the rest of the suite).
//
// MVP implements `manual-capture` and only that (it's what the first consumer's target needs — Azure AD SSO,
// ~1 h cookie — and it doubles as the keystone-spike's scaffolding auth). The other catalogue
// entries are interface-accommodated here but throw `NotImplementedStrategyError` until built.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AuthStrategyDescriptor, type RoleAuth, type StrategyName } from "./doc-pack.js";

// ---------------------------------------------------------------------------
// storageState
// ---------------------------------------------------------------------------

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

/** Result of authenticating a role: the captured session, plus an optional hard expiry the strategy knows. */
export interface AuthResult {
  storageState: StorageState;
  /** Epoch ms when the session is known to expire (e.g. from a cookie's `expires`). Optional. */
  expiresAt?: number;
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
}

/** A strategy: given an {@link AuthContext}, produce an {@link AuthResult}. One implementation per backend type. */
export interface AuthStrategy {
  readonly name: StrategyName;
  authenticate(ctx: AuthContext): Promise<AuthResult>;
}

export class NotImplementedStrategyError extends Error {
  constructor(name: StrategyName) {
    super(`auth strategy "${name}" is not implemented in this build (MVP ships \`manual-capture\` only)`);
    this.name = "NotImplementedStrategyError";
  }
}

export class AuthStrategyConfigError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AuthStrategyConfigError";
  }
}

// ---------------------------------------------------------------------------
// Descriptor (`auth/strategy.yaml`)
// ---------------------------------------------------------------------------

/** Parse + validate an `auth/strategy.yaml` descriptor from YAML text. */
export function parseAuthStrategyFile(yamlText: string, source = "<auth/strategy.yaml>"): AuthStrategyDescriptor {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    throw new AuthStrategyConfigError(`${source}: not valid YAML — ${(e as Error).message}`, e);
  }
  const r = AuthStrategyDescriptor.safeParse(raw);
  if (!r.success) {
    const issues = (r.error as z.ZodError).issues
      .map((i) => `  • ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("\n");
    throw new AuthStrategyConfigError(`${source}: invalid auth-strategy descriptor:\n${issues}`, r.error);
  }
  return r.data;
}

/** Resolve a role's `creds_env` name map into actual values from an env source (defaults to `process.env`). */
export function resolveCredsEnv(roleAuth: RoleAuth, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, varName] of Object.entries(roleAuth.creds_env)) {
    const v = env[varName];
    if (v === undefined || v === "") missing.push(`${key} → $${varName}`);
    else out[key] = v;
  }
  if (missing.length) {
    throw new AuthStrategyConfigError(
      `missing credential env vars:\n${missing.map((m) => `  • ${m}`).join("\n")}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local storageState cache (`.auth/<role>.json`) — used by expensive strategies (manual-capture, ui-form, ...)
// ---------------------------------------------------------------------------

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

  private file(role: string): string {
    // role names are simple identifiers in practice; still, keep the filename safe.
    const safe = role.replace(/[^A-Za-z0-9_.-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
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
      parsed = CachedStateSchema.parse(JSON.parse(text)) as CachedState;
    } catch {
      return null; // corrupt cache → treat as miss
    }
    if (parsed.expiresAt <= now) return null;
    return parsed.storageState;
  }

  /** Persist a captured session. `roleAuth.cache.ttl` plus the strategy's `expiresAt` determine the entry's expiry. */
  async save(role: string, result: AuthResult, roleAuth: RoleAuth, now = Date.now()): Promise<void> {
    const ttlMs = ttlToMs(roleAuth.cache.ttl);
    const byTtl = ttlMs === "session" ? undefined : now + ttlMs;
    // Earliest of: strategy-reported expiry, ttl-derived expiry. Fall back to +1h if neither is known.
    const candidates = [result.expiresAt, byTtl].filter((v): v is number => typeof v === "number");
    const expiresAt = candidates.length ? Math.min(...candidates) : now + 3_600_000;
    const entry: CachedState = { storageState: result.storageState, writtenAt: now, expiresAt };
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(role), JSON.stringify(entry, null, 2) + "\n", "utf8");
  }

  async clear(role: string): Promise<void> {
    await fs.rm(this.file(role), { force: true });
  }
}

// ---------------------------------------------------------------------------
// manual-capture
// ---------------------------------------------------------------------------

export type CaptureTrigger = "console" | "button";

/**
 * The browser the engine drives for `manual-capture` — a security-lowered, *instrumented* Chrome.
 * The Playwright-backed implementation lives in a separate module (so this strategy stays testable);
 * `--disable-web-security` etc. let the injected capture helper work across SSO-redirect origins.
 */
export interface InstrumentedBrowser {
  /** Launch the browser and open the target site. */
  open(baseURL: string): Promise<void>;
  /**
   * Inject the capture helper (a console function `window.__siteDocs.capture()` and/or an on-page button)
   * and resolve once the human triggers it. The human does the interactive login (SSO / MFA / conditional
   * access — anything they can click through) before triggering.
   */
  waitForCapture(trigger: CaptureTrigger): Promise<void>;
  /** Snapshot the current `storageState`. */
  storageState(): Promise<StorageState>;
  close(): Promise<void>;
}

export interface ManualCaptureOptions {
  /** `console` (default): `window.__siteDocs.capture()`. `button`: an injected on-page button. */
  capture_trigger?: CaptureTrigger;
}

/**
 * `manual-capture` — the plugin spawns a security-lowered, instrumented Chrome; the engineer logs in
 * interactively; a console command or an injected button snapshots `storageState`. The zero-integration
 * universal fallback for SSO / MFA / conditional access, at the cost of periodic human re-capture.
 */
export class ManualCaptureStrategy implements AuthStrategy {
  readonly name = "manual-capture" as const;
  constructor(private readonly browserFactory: () => InstrumentedBrowser) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = ctx.options as ManualCaptureOptions;
    const trigger: CaptureTrigger = opts.capture_trigger ?? "console";
    const browser = this.browserFactory();
    try {
      await browser.open(ctx.baseURL);
      await browser.waitForCapture(trigger);
      const storageState = await browser.storageState();
      return { storageState, expiresAt: earliestCookieExpiry(storageState) };
    } finally {
      await browser.close();
    }
  }
}

/** The earliest non-session cookie expiry (epoch ms), or `undefined` if all cookies are session cookies. */
export function earliestCookieExpiry(state: StorageState): number | undefined {
  const expiries = state.cookies
    .map((c) => c.expires)
    .filter((e) => typeof e === "number" && e > 0)
    .map((e) => e * 1000); // Playwright cookie `expires` is seconds since epoch (or -1 for session)
  return expiries.length ? Math.min(...expiries) : undefined;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface StrategyDeps {
  /** Factory for the instrumented browser `manual-capture` drives. Required if any role uses `manual-capture`. */
  instrumentedBrowser?: () => InstrumentedBrowser;
}

/** Build the {@link AuthStrategy} for a role. Throws {@link NotImplementedStrategyError} for unbuilt strategies. */
export function makeStrategy(roleAuth: RoleAuth, deps: StrategyDeps): AuthStrategy {
  switch (roleAuth.strategy) {
    case "manual-capture":
      if (!deps.instrumentedBrowser) {
        throw new AuthStrategyConfigError(
          "strategy `manual-capture` requires an instrumented-browser factory (deps.instrumentedBrowser)",
        );
      }
      return new ManualCaptureStrategy(deps.instrumentedBrowser);
    default:
      throw new NotImplementedStrategyError(roleAuth.strategy);
  }
}
