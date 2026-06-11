// `api-login` — POST the role's credentials to the app's login endpoint and keep the session
// cookies. Pure node fetch; no browser. The strategy of choice when the target has a JSON or
// form login API the operator may call directly.

import { z } from "zod";
import { fetchCollectingCookies, jarAuthExpiry } from "./cookie-jar.js";
import {
  AuthStrategyConfigError,
  parseStrategyOptions,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export const ApiLoginOptions = z
  .object({
    /** Login endpoint; resolved against the target's base URL when relative. */
    login_url: z.string().min(1),
    method: z.string().default("POST"),
    /** How the creds map is encoded into the request body. */
    body_format: z.enum(["json", "form"]).default("json"),
    /**
     * What "logged in" means. `cookie`: the jar must contain it after the redirect chain.
     * `status`: the final response status must equal it. `json_path`: the final JSON body at
     * the dotted path must equal `equals`. Default: final status < 400.
     */
    success_check: z
      .union([
        z.object({ cookie: z.string().min(1) }).strict(),
        z.object({ status: z.number().int() }).strict(),
        z.object({ json_path: z.string().min(1), equals: z.unknown() }).strict(),
      ])
      .optional(),
  })
  .strict();
export type ApiLoginOptions = z.infer<typeof ApiLoginOptions>;

/** Walk a dotted path (`a.b.c`) through a parsed JSON value. */
export function getJsonPath(value: unknown, dottedPath: string): unknown {
  let cur: unknown = value;
  for (const segment of dottedPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

export class ApiLoginStrategy implements AuthStrategy {
  readonly name = "api-login" as const;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, ApiLoginOptions, ctx.options);
    const url = new URL(opts.login_url, ctx.baseURL);
    const isJson = opts.body_format === "json";
    const body = isJson ? JSON.stringify(ctx.creds) : new URLSearchParams(ctx.creds).toString();

    const result = await fetchCollectingCookies(
      url,
      {
        method: opts.method,
        headers: {
          "content-type": isJson ? "application/json" : "application/x-www-form-urlencoded",
          accept: "application/json, text/html;q=0.9, */*;q=0.8",
        },
        body,
      },
      { fetchImpl: this.fetchImpl },
    );

    // Failure messages name the endpoint and the check — never the credential values.
    const check = opts.success_check;
    if (check === undefined) {
      if (result.status >= 400) {
        throw new AuthStrategyConfigError(
          `api-login: ${url.href} answered ${result.status} — login rejected (credentials read from env; values not shown)`,
        );
      }
    } else if ("cookie" in check) {
      if (!result.jar.has(check.cookie)) {
        const got = result.jar
          .cookies()
          .map((c) => c.name)
          .join(", ");
        throw new AuthStrategyConfigError(
          `api-login: expected cookie "${check.cookie}" was not set by ${url.href} (status ${result.status}; jar: ${got || "(empty)"})`,
        );
      }
    } else if ("status" in check) {
      if (result.status !== check.status) {
        throw new AuthStrategyConfigError(
          `api-login: expected status ${check.status} from ${url.href}, got ${result.status}`,
        );
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        throw new AuthStrategyConfigError(
          `api-login: success_check.json_path needs a JSON response, but ${result.url} (status ${result.status}) did not return valid JSON`,
        );
      }
      const actual = getJsonPath(parsed, check.json_path);
      if (JSON.stringify(actual) !== JSON.stringify(check.equals)) {
        throw new AuthStrategyConfigError(
          `api-login: success_check json_path "${check.json_path}" is ${JSON.stringify(actual)}, expected ${JSON.stringify(check.equals)}`,
        );
      }
    }

    const storageState = result.jar.toStorageState();
    const expiresAt = jarAuthExpiry(
      storageState,
      check && "cookie" in check ? check.cookie : undefined,
    );
    return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
  }
}
