// `webauthn` — passkey login through a CDP virtual authenticator. The authenticator is attached
// *before* navigation (so the login page's `navigator.credentials` sees a platform authenticator
// from its first feature probe), then the strategy walks the page's own passkey flow: optional
// username-first fill, click the trigger, wait for the logged-in marker, snapshot storageState.
//
// The virtual device is ctap2 / internal / user-verifying with automatic presence simulation —
// the standard headless-CI stand-in for Touch ID-style platform authenticators.

import { z } from "zod";
import { type AuthPageLauncher, launchAuthPage } from "./browser-session.js";
import { jarAuthExpiry } from "./cookie-jar.js";
import {
  PreStep,
  resolvePreStepValues,
  runPreSteps,
  waitForLoginSuccess,
} from "./ui-form.js";
import {
  AuthStrategyConfigError,
  maskSecret,
  parseStrategyOptions,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export const WebauthnOptions = z
  .object({
    /** Login page; resolved against the target's base URL when relative. */
    login_url: z.string().min(1),
    /** The "Sign in with a passkey" control that starts the WebAuthn ceremony. */
    trigger_selector: z.string().min(1),
    /** Username-first flows: filled with the `username` credential before the trigger. */
    username_selector: z.string().min(1).optional(),
    success_selector: z.string().min(1).optional(),
    url_matches: z.string().min(1).optional(),
    timeout_ms: z.number().int().positive().default(15_000),
    ignore_https_errors: z.boolean().default(false),
    pre_steps: z.array(PreStep).default([]),
  })
  .strict()
  .refine((o) => o.success_selector !== undefined || o.url_matches !== undefined, {
    message: "one of success_selector or url_matches is required",
  });
export type WebauthnOptions = z.infer<typeof WebauthnOptions>;

export class WebauthnStrategy implements AuthStrategy {
  readonly name = "webauthn" as const;
  constructor(
    private readonly launcher: AuthPageLauncher = launchAuthPage,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, WebauthnOptions, ctx.options);
    const { username } = ctx.creds;
    if (opts.username_selector && !username) {
      throw new AuthStrategyConfigError(
        `webauthn: username_selector is set, so creds_env must map "username" (${maskSecret(username)})`,
      );
    }
    const preStepValues = resolvePreStepValues(this.name, opts.pre_steps, this.env);

    const page = await this.launcher({
      baseURL: ctx.baseURL,
      ...(opts.ignore_https_errors ? { ignoreHTTPSErrors: true } : {}),
    });
    try {
      // Must precede goto: the page feature-detects authenticators at load.
      await page.enableVirtualAuthenticator();
      await page.goto(new URL(opts.login_url, ctx.baseURL).href);
      await runPreSteps(page, opts.pre_steps, preStepValues);
      if (opts.username_selector) await page.fill(opts.username_selector, username!);
      await page.click(opts.trigger_selector);

      await waitForLoginSuccess(page, opts, this.name);
      const storageState = await page.storageState();
      const expiresAt = jarAuthExpiry(storageState);
      return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
    } finally {
      await page.close();
    }
  }
}
