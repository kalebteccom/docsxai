// email-otp strategy — the form server "mails" the code into the fixture inbox; the strategy
// polls the inbox via the built-in http-json provider, extracts the code, and finishes the login.

import { afterEach, describe, expect, it } from "vitest";
import {
  AuthStrategyConfigError,
  EmailOtpStrategy,
  registerInboxProvider,
  unregisterInboxProvider,
  type InboxProvider,
} from "../src/auth.js";
import {
  FIXTURE_PASS,
  FIXTURE_USER,
  startFormLoginServer,
  startInboxServer,
  type FixtureServer,
} from "./fixtures/auth-servers.js";
import { makeFakeFormPage } from "./fixtures/fake-form-page.js";

type InboxFixture = Awaited<ReturnType<typeof startInboxServer>>;

const GOOD_CREDS = { username: FIXTURE_USER, password: FIXTURE_PASS };

const BASE_OPTIONS = {
  login_url: "/login",
  username_selector: "#user",
  password_selector: "#pass",
  submit_selector: "#submit",
  otp_selector: "#otp",
  otp_submit_selector: "#otp-submit",
  success_selector: "#welcome",
  pre_steps: [{ action: "click", selector: "#dismiss" }],
};

const servers: FixtureServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/** Form server that delivers each issued OTP to the inbox as a mail body, after `mailDelayMs`. */
async function startRig(opts: { to?: string; mailBody?: (code: string) => string } = {}) {
  const inbox = await startInboxServer();
  const form = await startFormLoginServer({
    onOtpIssued: (code) =>
      inbox.deliver({
        to: opts.to ?? FIXTURE_USER,
        body: opts.mailBody?.(code) ?? `Your verification code is ${code}.`,
        afterMs: 30,
      }),
  });
  servers.push(inbox, form);
  return { inbox, form };
}

function strategy(env: NodeJS.ProcessEnv = {}) {
  return new EmailOtpStrategy(async (opts) => makeFakeFormPage(opts), env);
}

function ctx(form: FixtureServer, options: Record<string, unknown>, creds = GOOD_CREDS) {
  return { creds, options, baseURL: form.url, role: "editor" };
}

function inboxOptions(inbox: InboxFixture, extra: Record<string, unknown> = {}) {
  return { options: { url: `${inbox.url}/inbox`, poll_interval_ms: 25 }, ...extra };
}

describe("email-otp strategy", () => {
  it("polls the inbox, extracts the 6-digit code with the default pattern, and logs in", async () => {
    const { inbox, form } = await startRig();
    const r = await strategy().authenticate(
      ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox) }),
    );
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
    expect(r.expiresAt).toBeDefined();
  });

  it("ignores messages received before the login submit (stale codes)", async () => {
    const { inbox, form } = await startRig();
    inbox.deliver({ to: FIXTURE_USER, body: "Your verification code is 000000." });
    await new Promise((r) => setTimeout(r, 10)); // stale mail strictly precedes `since`
    const r = await strategy().authenticate(
      ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox) }),
    );
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
  });

  it("ignores messages addressed to someone else and times out with a config error", async () => {
    const { inbox, form } = await startRig({ to: "someone-else@example.test" });
    await expect(
      strategy().authenticate(
        ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox, { timeout_ms: 300 }) }),
      ),
    ).rejects.toThrow(/no message for the watched address arrived within 300ms/);
  });

  it("watches the inbox.to_env address instead of the username credential", async () => {
    const { inbox, form } = await startRig({ to: "ops-inbox@example.test" });
    const r = await strategy({ OTP_INBOX_TO: "ops-inbox@example.test" }).authenticate(
      ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox, { to_env: "OTP_INBOX_TO" }) }),
    );
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
  });

  it("supports a custom code_pattern with a capture group", async () => {
    const { inbox, form } = await startRig({
      mailBody: (code) => `ref 999999 — enter token:${code} to continue`,
    });
    const r = await strategy().authenticate(
      ctx(form, {
        ...BASE_OPTIONS,
        inbox: inboxOptions(inbox, { code_pattern: "token:(\\d{6})" }),
      }),
    );
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
  });

  it("fails with a pattern-naming config error when code_pattern does not match the mail", async () => {
    const { inbox, form } = await startRig({ mailBody: () => "no code in here" });
    await expect(
      strategy().authenticate(ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox) })),
    ).rejects.toThrow(/code_pattern \/\\b\(\\d\{6\}\)\\b\/ did not match/);
  });

  it("rejects an invalid code_pattern and an unknown provider before launching", async () => {
    const { inbox, form } = await startRig();
    await expect(
      strategy().authenticate(
        ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox, { code_pattern: "(" }) }),
      ),
    ).rejects.toThrow(/not a valid regex/);
    await expect(
      strategy().authenticate(
        ctx(form, { ...BASE_OPTIONS, inbox: { provider: "carrier-pigeon", options: {} } }),
      ),
    ).rejects.toThrow(/unknown inbox provider "carrier-pigeon" \(known: http-json\)/);
  });

  it("uses a provider registered via registerInboxProvider", async () => {
    const seen: Array<{ to: string }> = [];
    let issued = "";
    const canned: InboxProvider = {
      async waitForMessage(q) {
        seen.push({ to: q.to });
        // wait for the form server to have issued the code (handed over via onOtpIssued)
        for (let i = 0; !issued && i < 100; i++) await new Promise((r) => setTimeout(r, 10));
        return { to: q.to, receivedAt: Date.now(), body: `code ${issued}` };
      },
    };
    const form = await startFormLoginServer({ onOtpIssued: (code) => (issued = code) });
    servers.push(form);
    registerInboxProvider("canned", () => canned);
    try {
      const r = await strategy().authenticate(
        ctx(form, { ...BASE_OPTIONS, inbox: { provider: "canned", options: {} } }),
      );
      expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
      expect(seen).toEqual([{ to: FIXTURE_USER }]);
    } finally {
      unregisterInboxProvider("canned");
    }
  });

  it("rejects creds without username/password and surfaces AuthStrategyConfigError", async () => {
    const { inbox, form } = await startRig();
    await expect(
      strategy().authenticate(ctx(form, { ...BASE_OPTIONS, inbox: inboxOptions(inbox) }, {})),
    ).rejects.toThrow(AuthStrategyConfigError);
  });
});
