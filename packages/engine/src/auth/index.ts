// Target-site auth layer.
//
// Every strategy produces a `storageState` (cookies + localStorage + sessionStorage) — the
// universal artifact every auth scheme reduces to — plus, for connection-level schemes
// (HTTP Basic, PAT headers, mTLS), `contextOptions` the session launcher passes through to
// the browser context. One module per strategy; this index holds the descriptor parsing,
// the credential resolution, and the strategy registry.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AuthStrategyDescriptor, type RoleAuth } from "../doc-pack.js";
import { ApiLoginStrategy } from "./api-login.js";
import { launchAuthPage } from "./browser-session.js";
import { EmailOtpStrategy } from "./email-otp.js";
import { HttpBasicStrategy } from "./http-basic.js";
import { JwtInjectionStrategy } from "./jwt-injection.js";
import { type InstrumentedBrowser, ManualCaptureStrategy } from "./manual-capture.js";
import { MtlsStrategy } from "./mtls.js";
import { PatHeaderStrategy } from "./pat-header.js";
import { TestBackdoorStrategy } from "./test-backdoor.js";
import { TotpStrategy } from "./totp.js";
import { UiFormStrategy } from "./ui-form.js";
import {
  AuthStrategyConfigError,
  NotImplementedStrategyError,
  type AuthStrategy,
} from "./types.js";

export * from "./types.js";
export * from "./cookie-jar.js";
export * from "./api-login.js";
export * from "./browser-session.js";
export * from "./email-otp.js";
export * from "./http-basic.js";
export * from "./jwt-injection.js";
export * from "./manual-capture.js";
export * from "./mtls.js";
export * from "./pat-header.js";
export * from "./storage-state-cache.js";
export * from "./test-backdoor.js";
export * from "./totp.js";
export * from "./ui-form.js";

// ---------------------------------------------------------------------------
// Descriptor (`auth/strategy.yaml`)
// ---------------------------------------------------------------------------

/** Parse + validate an `auth/strategy.yaml` descriptor from YAML text. */
export function parseAuthStrategyFile(
  yamlText: string,
  source = "<auth/strategy.yaml>",
): AuthStrategyDescriptor {
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
    throw new AuthStrategyConfigError(
      `${source}: invalid auth-strategy descriptor:\n${issues}`,
      r.error,
    );
  }
  return r.data;
}

/** Resolve a role's `creds_env` name map into actual values from an env source (defaults to `process.env`). */
export function resolveCredsEnv(
  roleAuth: RoleAuth,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
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

/**
 * Like {@link resolveCredsEnv}, with **user-pool** support: any credential env value may be a
 * comma-separated pool (`user1,user2,user3`); each parallel worker picks `pool[workerIndex % len]`,
 * consistently across every pooled variable, so worker N always gets user N's username *and* password.
 */
export function resolveCreds(
  roleAuth: RoleAuth,
  opts: { workerIndex?: number; env?: NodeJS.ProcessEnv } = {},
): Record<string, string> {
  const workerIndex = opts.workerIndex ?? 0;
  const raw = resolveCredsEnv(roleAuth, opts.env ?? process.env);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const pool = value.split(",").map((v) => v.trim());
    out[key] = pool.length > 1 ? pool[workerIndex % pool.length]! : value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface StrategyDeps {
  /** Factory for the instrumented browser `manual-capture` drives. Required if any role uses `manual-capture`. */
  instrumentedBrowser?: () => InstrumentedBrowser;
  /** Env source for strategies that read env-var *names* out of options (`token_env`, `totp.secret_env`). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

const registry = new Map<string, AuthStrategy>();

/**
 * Register (or override) an auth strategy under `name`. The plugins-runtime hook: registered
 * strategies are consulted *before* the built-ins, so a plugin can both add new schemes and
 * replace a built-in for a quirky target.
 */
export function registerAuthStrategy(name: string, impl: AuthStrategy): void {
  registry.set(name, impl);
}

/** Remove a registered strategy (test/plugin teardown). */
export function unregisterAuthStrategy(name: string): void {
  registry.delete(name);
}

/** Build the {@link AuthStrategy} for a role: registry first, then the built-in catalogue. */
export function makeStrategy(roleAuth: RoleAuth, deps: StrategyDeps): AuthStrategy {
  const registered = registry.get(roleAuth.strategy);
  if (registered) return registered;
  switch (roleAuth.strategy) {
    case "manual-capture":
      if (!deps.instrumentedBrowser) {
        throw new AuthStrategyConfigError(
          "strategy `manual-capture` requires an instrumented-browser factory (deps.instrumentedBrowser)",
        );
      }
      return new ManualCaptureStrategy(deps.instrumentedBrowser);
    case "api-login":
      return new ApiLoginStrategy();
    case "jwt-injection":
      return new JwtInjectionStrategy(fetch, deps.env);
    case "http-basic":
      return new HttpBasicStrategy();
    case "pat-header":
      return new PatHeaderStrategy();
    case "mtls":
      return new MtlsStrategy();
    case "test-backdoor":
      return new TestBackdoorStrategy();
    case "totp":
      return new TotpStrategy();
    case "ui-form":
      return new UiFormStrategy(launchAuthPage, deps.env);
    case "email-otp":
      return new EmailOtpStrategy(launchAuthPage, deps.env);
    default:
      throw new NotImplementedStrategyError(roleAuth.strategy);
  }
}
