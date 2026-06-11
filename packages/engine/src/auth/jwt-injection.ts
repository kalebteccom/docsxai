// `jwt-injection` — obtain a bearer token (static env var, or an OAuth2 client-credentials
// grant) and inject it into the browser's storage the way the target SPA expects it:
// localStorage keys and/or cookies, rendered from `{{token}}` templates. Pure node, no browser.

import { z } from "zod";
import {
  AuthStrategyConfigError,
  maskSecret,
  parseStrategyOptions,
  renderTemplate,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
  type StorageState,
} from "./types.js";

export const JwtInjectionOptions = z
  .object({
    /** Env var *name* holding a static token. Mutually exclusive with `token_url`. */
    token_env: z.string().min(1).optional(),
    /** OAuth2 token endpoint for a client-credentials grant (creds: `client_id`, `client_secret`). */
    token_url: z.string().min(1).optional(),
    /** Where the token goes. At least one of `localStorage` / `cookies`. */
    inject: z
      .object({
        localStorage: z
          .array(
            z
              .object({
                key: z.string().min(1),
                /** `{{token}}` template; default `{{token}}`. */
                value_template: z.string().min(1).default("{{token}}"),
              })
              .strict(),
          )
          .optional(),
        cookies: z
          .array(
            z
              .object({
                name: z.string().min(1),
                value_template: z.string().min(1).default("{{token}}"),
                domain: z.string().min(1).optional(),
                path: z.string().min(1).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .refine((i) => (i.localStorage?.length ?? 0) + (i.cookies?.length ?? 0) > 0, {
        message: "inject needs at least one localStorage or cookies entry",
      }),
  })
  .strict()
  .refine((o) => (o.token_env !== undefined) !== (o.token_url !== undefined), {
    message: "exactly one of token_env or token_url is required",
  });
export type JwtInjectionOptions = z.infer<typeof JwtInjectionOptions>;

/** Decode a JWT's payload (base64url, **no signature verification**) — claims-reading only. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export class JwtInjectionStrategy implements AuthStrategy {
  readonly name = "jwt-injection" as const;
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async obtainToken(
    opts: JwtInjectionOptions,
    ctx: AuthContext,
  ): Promise<{ token: string; expiresAt?: number }> {
    if (opts.token_env !== undefined) {
      const token = this.env[opts.token_env];
      if (!token) {
        throw new AuthStrategyConfigError(
          `jwt-injection: token env var $${opts.token_env} is ${maskSecret(token)}`,
        );
      }
      return { token, expiresAt: expiryFromJwt(token) };
    }

    const { client_id: clientId, client_secret: clientSecret } = ctx.creds;
    if (!clientId || !clientSecret) {
      throw new AuthStrategyConfigError(
        `jwt-injection: token_url needs creds_env mapping client_id (${maskSecret(clientId)}) and client_secret (${maskSecret(clientSecret)})`,
      );
    }
    const tokenUrl = new URL(opts.token_url!, ctx.baseURL);
    const response = await this.fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!response.ok) {
      throw new AuthStrategyConfigError(
        `jwt-injection: token endpoint ${tokenUrl.href} answered ${response.status} (client_secret: ${maskSecret(clientSecret)} — value not shown)`,
      );
    }
    let body: { access_token?: string; expires_in?: number };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new AuthStrategyConfigError(
        `jwt-injection: token endpoint ${tokenUrl.href} did not return JSON`,
      );
    }
    if (!body.access_token) {
      throw new AuthStrategyConfigError(
        `jwt-injection: token endpoint ${tokenUrl.href} returned no access_token`,
      );
    }
    const fromExpiresIn =
      typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined;
    const expiresAt = fromExpiresIn ?? expiryFromJwt(body.access_token);
    return { token: body.access_token, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, JwtInjectionOptions, ctx.options);
    const { token, expiresAt } = await this.obtainToken(opts, ctx);
    const base = new URL(ctx.baseURL);
    const vars = { token };

    const storageState: StorageState = { cookies: [], origins: [] };
    const entries = (opts.inject.localStorage ?? []).map((e) => ({
      name: e.key,
      value: renderTemplate(e.value_template, vars),
    }));
    if (entries.length) storageState.origins.push({ origin: base.origin, localStorage: entries });

    for (const c of opts.inject.cookies ?? []) {
      storageState.cookies.push({
        name: c.name,
        value: renderTemplate(c.value_template, vars),
        domain: c.domain ?? base.hostname,
        path: c.path ?? "/",
        expires: expiresAt !== undefined ? Math.floor(expiresAt / 1000) : -1,
        httpOnly: false,
        secure: base.protocol === "https:",
        sameSite: "Lax",
      });
    }

    return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }
}

function expiryFromJwt(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
}
