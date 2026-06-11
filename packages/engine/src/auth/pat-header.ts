// `pat-header` — connection-level auth: every request the browser context makes carries a
// personal-access-token header (`Authorization: Bearer <token>` by default). Empty storageState;
// the strategy emits `contextOptions.extraHTTPHeaders`.

import { z } from "zod";
import {
  AuthStrategyConfigError,
  emptyStorageState,
  maskSecret,
  parseStrategyOptions,
  renderTemplate,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export const PatHeaderOptions = z
  .object({
    /** Header name. Default `Authorization`. */
    header: z.string().min(1).default("Authorization"),
    /** `{{token}}` template for the header value. Default `Bearer {{token}}`. */
    value_template: z.string().min(1).default("Bearer {{token}}"),
  })
  .strict();
export type PatHeaderOptions = z.infer<typeof PatHeaderOptions>;

export class PatHeaderStrategy implements AuthStrategy {
  readonly name = "pat-header" as const;

  authenticate(ctx: AuthContext): Promise<AuthResult> {
    try {
      const opts = parseStrategyOptions(this.name, PatHeaderOptions, ctx.options);
      const token = ctx.creds.token;
      if (!token) {
        throw new AuthStrategyConfigError(
          `pat-header: creds_env must map "token" to the env var holding the access token (token: ${maskSecret(token)})`,
        );
      }
      return Promise.resolve({
        storageState: emptyStorageState(),
        contextOptions: {
          extraHTTPHeaders: { [opts.header]: renderTemplate(opts.value_template, { token }) },
        },
      });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
