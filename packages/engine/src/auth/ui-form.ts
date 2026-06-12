// `ui-form` — drive the app's own login form in a headless Chromium: fill username/password,
// submit, wait for the logged-in marker, snapshot storageState. `pre_steps` dismiss cookie
// banners and similar pre-login chrome; `options.totp` hooks an RFC-6238 one-time code in after
// the password submit (the `totp` catalogue entry composes this strategy).

import { z } from "zod";
import { type AuthPage, type AuthPageLauncher, launchAuthPage } from "./browser-session.js";
import { jarAuthExpiry } from "./cookie-jar.js";
import { generateTotp } from "./totp.js";
import {
  AuthStrategyConfigError,
  maskSecret,
  parseStrategyOptions,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

/** One pre-login step (cookie banner, locale picker) shared by the browser-driving strategies. */
export const PreStep = z
  .object({
    action: z.enum(["click", "fill"]),
    selector: z.string().min(1),
    /** Env var *name* holding the fill value (required for `fill`). */
    value_env: z.string().min(1).optional(),
  })
  .strict();
export type PreStep = z.infer<typeof PreStep>;

/** Read a required env var by *name*; missing/empty → config error that never echoes a value. */
export function requireEnvVar(
  strategy: string,
  what: string,
  varName: string,
  env: NodeJS.ProcessEnv,
): string {
  const value = env[varName];
  if (!value) {
    throw new AuthStrategyConfigError(`${strategy}: ${what} $${varName} is ${maskSecret(value)}`);
  }
  return value;
}

/** Resolve every `fill` pre-step's `value_env` up front, so a missing var fails before any browser launches. */
export function resolvePreStepValues(
  strategy: string,
  steps: PreStep[],
  env: NodeJS.ProcessEnv,
): string[] {
  return steps.map((step) => {
    if (step.action !== "fill") return "";
    if (!step.value_env) {
      throw new AuthStrategyConfigError(
        `${strategy}: pre_steps fill on "${step.selector}" needs value_env (the env var name to fill from)`,
      );
    }
    return requireEnvVar(strategy, "pre_steps value_env", step.value_env, env);
  });
}

/** Execute pre-login steps in order (`values` from {@link resolvePreStepValues}, index-aligned). */
export async function runPreSteps(
  page: AuthPage,
  steps: PreStep[],
  values: string[],
): Promise<void> {
  for (const [i, step] of steps.entries()) {
    if (step.action === "click") await page.click(step.selector);
    else await page.fill(step.selector, values[i]!);
  }
}

export const UiFormTotpOptions = z
  .object({
    /** Env var *name* holding the base32 TOTP secret. */
    secret_env: z.string().min(1),
    otp_selector: z.string().min(1),
    submit_selector: z.string().min(1).optional(),
    digits: z.union([z.literal(6), z.literal(8)]).default(6),
    period: z.number().int().positive().default(30),
    algorithm: z.enum(["sha1", "sha256"]).default("sha1"),
  })
  .strict();
export type UiFormTotpOptions = z.infer<typeof UiFormTotpOptions>;

export const UiFormOptions = z
  .object({
    /** Login page; resolved against the target's base URL when relative. */
    login_url: z.string().min(1),
    username_selector: z.string().min(1),
    password_selector: z.string().min(1),
    submit_selector: z.string().min(1),
    /** Logged-in marker: a selector that appears… */
    success_selector: z.string().min(1).optional(),
    /** …or a regex (source) the post-login URL matches. One of the two is required. */
    url_matches: z.string().min(1).optional(),
    /** Per-wait timeout. Default 15000. */
    timeout_ms: z.number().int().positive().default(15_000),
    ignore_https_errors: z.boolean().default(false),
    /** Pre-login chrome (cookie banners, locale pickers): clicked / filled before the form. */
    pre_steps: z.array(PreStep).default([]),
    totp: UiFormTotpOptions.optional(),
  })
  .strict()
  .refine((o) => o.success_selector !== undefined || o.url_matches !== undefined, {
    message: "one of success_selector or url_matches is required",
  });
export type UiFormOptions = z.infer<typeof UiFormOptions>;

export class UiFormStrategy implements AuthStrategy {
  readonly name = "ui-form" as const;
  constructor(
    private readonly launcher: AuthPageLauncher = launchAuthPage,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, UiFormOptions, ctx.options);
    const { username, password } = ctx.creds;
    if (!username || !password) {
      throw new AuthStrategyConfigError(
        `ui-form: creds_env must map "username" (${maskSecret(username)}) and "password" (${maskSecret(password)})`,
      );
    }
    // Read env-var-name options up front so a missing var fails before a browser launches.
    const totpSecret = opts.totp
      ? requireEnvVar(this.name, "totp.secret_env", opts.totp.secret_env, this.env)
      : "";
    const preStepValues = resolvePreStepValues(this.name, opts.pre_steps, this.env);

    const page = await this.launcher({
      baseURL: ctx.baseURL,
      ...(opts.ignore_https_errors ? { ignoreHTTPSErrors: true } : {}),
    });
    try {
      await page.goto(new URL(opts.login_url, ctx.baseURL).href);
      await runPreSteps(page, opts.pre_steps, preStepValues);
      await page.fill(opts.username_selector, username);
      await page.fill(opts.password_selector, password);
      await page.click(opts.submit_selector);

      if (opts.totp) {
        await this.waitStep(page, opts.totp.otp_selector, opts.timeout_ms, "the TOTP prompt");
        await page.fill(
          opts.totp.otp_selector,
          generateTotp(totpSecret, {
            digits: opts.totp.digits,
            period: opts.totp.period,
            algorithm: opts.totp.algorithm,
          }),
        );
        if (opts.totp.submit_selector) await page.click(opts.totp.submit_selector);
      }

      await waitForLoginSuccess(page, opts, "ui-form");
      const storageState = await page.storageState();
      const expiresAt = jarAuthExpiry(storageState);
      return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
    } finally {
      await page.close();
    }
  }

  private async waitStep(
    page: AuthPage,
    selector: string,
    timeoutMs: number,
    what: string,
  ): Promise<void> {
    try {
      await page.waitForSelector(selector, { timeoutMs });
    } catch {
      throw new AuthStrategyConfigError(
        `ui-form: ${what} ("${selector}") did not appear within ${timeoutMs}ms`,
      );
    }
  }
}

/** Shared success wait: a selector that appears, or a URL regex match. Timeouts become config errors. */
export async function waitForLoginSuccess(
  page: AuthPage,
  opts: { success_selector?: string; url_matches?: string; timeout_ms: number },
  strategy: string,
): Promise<void> {
  try {
    if (opts.success_selector !== undefined) {
      await page.waitForSelector(opts.success_selector, { timeoutMs: opts.timeout_ms });
    } else {
      await page.waitForUrl(new RegExp(opts.url_matches!), { timeoutMs: opts.timeout_ms });
    }
  } catch {
    const expected =
      opts.success_selector !== undefined
        ? `success_selector "${opts.success_selector}"`
        : `url matching /${opts.url_matches}/`;
    throw new AuthStrategyConfigError(
      `${strategy}: login did not reach ${expected} within ${opts.timeout_ms}ms — check the credential env vars (values not shown) and the selectors`,
    );
  }
}
