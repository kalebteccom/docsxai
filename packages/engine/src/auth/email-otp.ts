// `email-otp` — a ui-form login whose second factor arrives by email: fill + submit the
// credential form, wait for the OTP prompt, poll an inbox for the code mail, extract the code
// with `code_pattern`, submit it, capture storageState.
//
// The inbox side is pluggable: an `InboxProvider` answers "the first message for <address>
// received after <instant>". The built-in `http-json` provider polls a Mailpit-style JSON
// endpoint; test inboxes with other shapes register theirs via `registerInboxProvider` (the
// plugins runtime exposes the same hook).

import { z } from "zod";
import { type AuthPageLauncher, launchAuthPage } from "./browser-session.js";
import { jarAuthExpiry } from "./cookie-jar.js";
import {
  PreStep,
  requireEnvVar,
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

// ---------------------------------------------------------------------------
// Inbox providers
// ---------------------------------------------------------------------------

export interface InboxMessage {
  to: string;
  /** Epoch ms the inbox recorded the message. */
  receivedAt: number;
  /** Plain-text body the code is extracted from. */
  body: string;
}

export interface InboxProvider {
  /** Resolve with the newest message for `to` received at/after `since`; reject after `timeoutMs`. */
  waitForMessage(query: { to: string; since: number; timeoutMs: number }): Promise<InboxMessage>;
}

export type InboxProviderFactory = (options: Record<string, unknown>) => InboxProvider;

export const HttpJsonInboxOptions = z
  .object({
    /** Inbox endpoint answering `{ messages: [{ to, received_at, body }] }`. */
    url: z.string().min(1),
    poll_interval_ms: z.number().int().positive().default(250),
  })
  .strict();
export type HttpJsonInboxOptions = z.infer<typeof HttpJsonInboxOptions>;

/** Built-in provider: poll a Mailpit-style JSON inbox until the code mail shows up. */
export function httpJsonInboxProvider(options: Record<string, unknown>): InboxProvider {
  const opts = parseStrategyOptions("email-otp (inbox http-json)", HttpJsonInboxOptions, options);
  return {
    async waitForMessage({ to, since, timeoutMs }) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const res = await fetch(opts.url);
        if (res.ok) {
          const parsed = (await res.json()) as {
            messages?: Array<{ to?: string; received_at?: string; body?: string }>;
          };
          const hit = (parsed.messages ?? [])
            .filter((m) => m.to === to && Date.parse(m.received_at ?? "") >= since)
            .at(-1);
          if (hit) {
            return { to: hit.to!, receivedAt: Date.parse(hit.received_at!), body: hit.body ?? "" };
          }
        }
        if (Date.now() >= deadline) {
          throw new AuthStrategyConfigError(
            `email-otp: no message for the watched address arrived within ${timeoutMs}ms`,
          );
        }
        await new Promise((r) => setTimeout(r, opts.poll_interval_ms));
      }
    },
  };
}

const inboxProviders = new Map<string, InboxProviderFactory>([
  ["http-json", httpJsonInboxProvider],
]);

/** Register (or override) an inbox provider under `name` — the email-otp plugin hook. */
export function registerInboxProvider(name: string, factory: InboxProviderFactory): void {
  inboxProviders.set(name, factory);
}

/** Remove a registered provider (test/plugin teardown). Removing `http-json` restores the built-in. */
export function unregisterInboxProvider(name: string): void {
  inboxProviders.delete(name);
  if (name === "http-json") inboxProviders.set("http-json", httpJsonInboxProvider);
}

export function makeInboxProvider(name: string, options: Record<string, unknown>): InboxProvider {
  const factory = inboxProviders.get(name);
  if (!factory) {
    throw new AuthStrategyConfigError(
      `email-otp: unknown inbox provider "${name}" (known: ${[...inboxProviders.keys()].join(", ")})`,
    );
  }
  return factory(options);
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export const EmailOtpInboxOptions = z
  .object({
    provider: z.string().min(1).default("http-json"),
    /** Provider-specific options (for `http-json`: `{ url, poll_interval_ms? }`). */
    options: z.record(z.string(), z.unknown()).default({}),
    /** Env var *name* holding the inbox address to watch. Default: the role's `username` credential. */
    to_env: z.string().min(1).optional(),
    /** Code-extraction regex (first capture group, else the whole match). */
    code_pattern: z.string().min(1).default("\\b(\\d{6})\\b"),
    /** How long to wait for the code mail. Default 30000. */
    timeout_ms: z.number().int().positive().default(30_000),
  })
  .strict();
export type EmailOtpInboxOptions = z.infer<typeof EmailOtpInboxOptions>;

export const EmailOtpOptions = z
  .object({
    login_url: z.string().min(1),
    username_selector: z.string().min(1),
    password_selector: z.string().min(1),
    submit_selector: z.string().min(1),
    otp_selector: z.string().min(1),
    otp_submit_selector: z.string().min(1).optional(),
    success_selector: z.string().min(1).optional(),
    url_matches: z.string().min(1).optional(),
    timeout_ms: z.number().int().positive().default(15_000),
    ignore_https_errors: z.boolean().default(false),
    pre_steps: z.array(PreStep).default([]),
    inbox: EmailOtpInboxOptions,
  })
  .strict()
  .refine((o) => o.success_selector !== undefined || o.url_matches !== undefined, {
    message: "one of success_selector or url_matches is required",
  });
export type EmailOtpOptions = z.infer<typeof EmailOtpOptions>;

export class EmailOtpStrategy implements AuthStrategy {
  readonly name = "email-otp" as const;
  constructor(
    private readonly launcher: AuthPageLauncher = launchAuthPage,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, EmailOtpOptions, ctx.options);
    const { username, password } = ctx.creds;
    if (!username || !password) {
      throw new AuthStrategyConfigError(
        `email-otp: creds_env must map "username" (${maskSecret(username)}) and "password" (${maskSecret(password)})`,
      );
    }
    const to = opts.inbox.to_env
      ? requireEnvVar(this.name, "inbox.to_env", opts.inbox.to_env, this.env)
      : username;
    let codePattern: RegExp;
    try {
      codePattern = new RegExp(opts.inbox.code_pattern);
    } catch {
      throw new AuthStrategyConfigError(
        `email-otp: inbox.code_pattern /${opts.inbox.code_pattern}/ is not a valid regex`,
      );
    }
    const preStepValues = resolvePreStepValues(this.name, opts.pre_steps, this.env);
    const provider = makeInboxProvider(opts.inbox.provider, opts.inbox.options);

    const page = await this.launcher({
      baseURL: ctx.baseURL,
      ...(opts.ignore_https_errors ? { ignoreHTTPSErrors: true } : {}),
    });
    try {
      await page.goto(new URL(opts.login_url, ctx.baseURL).href);
      await runPreSteps(page, opts.pre_steps, preStepValues);
      await page.fill(opts.username_selector, username);
      await page.fill(opts.password_selector, password);
      const since = Date.now(); // the code mail is sent in response to this submit
      await page.click(opts.submit_selector);

      try {
        await page.waitForSelector(opts.otp_selector, { timeoutMs: opts.timeout_ms });
      } catch {
        throw new AuthStrategyConfigError(
          `email-otp: the OTP prompt ("${opts.otp_selector}") did not appear within ${opts.timeout_ms}ms — check the credential env vars (values not shown) and the selectors`,
        );
      }

      const message = await provider.waitForMessage({
        to,
        since,
        timeoutMs: opts.inbox.timeout_ms,
      });
      const match = codePattern.exec(message.body);
      const code = match ? (match[1] ?? match[0]) : undefined;
      if (!code) {
        throw new AuthStrategyConfigError(
          `email-otp: inbox.code_pattern /${opts.inbox.code_pattern}/ did not match the received message`,
        );
      }
      await page.fill(opts.otp_selector, code);
      if (opts.otp_submit_selector) await page.click(opts.otp_submit_selector);

      await waitForLoginSuccess(page, opts, this.name);
      const storageState = await page.storageState();
      const expiresAt = jarAuthExpiry(storageState);
      return { storageState, ...(expiresAt !== undefined ? { expiresAt } : {}) };
    } finally {
      await page.close();
    }
  }
}
