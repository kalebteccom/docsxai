// `test-backdoor` — POST a shared secret to a test-only login endpoint the target app exposes in
// non-production builds, and keep the session cookies it sets. The unattended-execution answer
// when the app team can ship a backdoor route; the secret lives in env, never in the descriptor.

import { z } from "zod";
import { fetchCollectingCookies, jarAuthExpiry } from "./cookie-jar.js";
import {
  AuthStrategyConfigError,
  maskSecret,
  parseStrategyOptions,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export const TestBackdoorOptions = z
  .object({
    /** Backdoor endpoint; resolved against the target's base URL when relative. */
    url: z.string().min(1),
    /** User to impersonate; sent verbatim in the request body. */
    user_id: z.union([z.string(), z.number()]).optional(),
    /** Cookie that proves the backdoor worked. Optional; any Set-Cookie + non-4xx passes without it. */
    success_cookie: z.string().min(1).optional(),
  })
  .strict();
export type TestBackdoorOptions = z.infer<typeof TestBackdoorOptions>;

export class TestBackdoorStrategy implements AuthStrategy {
  readonly name = "test-backdoor" as const;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, TestBackdoorOptions, ctx.options);
    const secret = ctx.creds.secret;
    if (!secret) {
      throw new AuthStrategyConfigError(
        `test-backdoor: creds_env must map "secret" to the env var holding the backdoor secret (secret: ${maskSecret(secret)})`,
      );
    }
    const url = new URL(opts.url, ctx.baseURL);
    const result = await fetchCollectingCookies(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret,
          ...(opts.user_id !== undefined ? { user_id: opts.user_id } : {}),
        }),
      },
      { fetchImpl: this.fetchImpl },
    );

    if (result.status >= 400) {
      throw new AuthStrategyConfigError(
        `test-backdoor: ${url.href} answered ${result.status} (secret: ${maskSecret(secret)} — value not shown)`,
      );
    }
    if (opts.success_cookie && !result.jar.has(opts.success_cookie)) {
      throw new AuthStrategyConfigError(
        `test-backdoor: expected cookie "${opts.success_cookie}" was not set by ${url.href}`,
      );
    }
    if (result.jar.cookies().length === 0) {
      throw new AuthStrategyConfigError(
        `test-backdoor: ${url.href} answered ${result.status} but set no cookies — nothing to capture`,
      );
    }

    const storageState = result.jar.toStorageState();
    const expiresAt = jarAuthExpiry(storageState, opts.success_cookie);
    return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }
}
