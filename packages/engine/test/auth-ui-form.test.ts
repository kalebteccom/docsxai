// ui-form strategy — full login choreography against the fixture HTML form server, driven by the
// browserless fake AuthPage (HTTP + the engine's cookie jar). The TOTP variant submits a real
// RFC-6238 code that the server verifies (±1 step). A Chromium-gated block repeats the happy path
// through the real Playwright-backed launcher.

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStrategyConfigError, UiFormStrategy, launchAuthPage } from "../src/auth.js";
import {
  FIXTURE_PASS,
  FIXTURE_TOTP_SECRET,
  FIXTURE_USER,
  startFormLoginServer,
  type FixtureServer,
} from "./fixtures/auth-servers.js";
import { makeFakeFormPage, type FakeFormPage } from "./fixtures/fake-form-page.js";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const GOOD_CREDS = { username: FIXTURE_USER, password: FIXTURE_PASS };

const BASE_OPTIONS = {
  login_url: "/login",
  username_selector: "#user",
  password_selector: "#pass",
  submit_selector: "#submit",
  pre_steps: [{ action: "click", selector: "#dismiss" }],
};

function strategyWith(env: NodeJS.ProcessEnv = {}): {
  strategy: UiFormStrategy;
  pages: FakeFormPage[];
} {
  const pages: FakeFormPage[] = [];
  const strategy = new UiFormStrategy(async (opts) => {
    const page = makeFakeFormPage(opts);
    pages.push(page);
    return page;
  }, env);
  return { strategy, pages };
}

describe("ui-form strategy — plain form login", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFormLoginServer();
  });
  afterAll(() => server.close());

  const ctx = (options: Record<string, unknown>, creds: Record<string, string> = GOOD_CREDS) => ({
    creds,
    options,
    baseURL: server.url,
    role: "editor",
  });

  it("dismisses the overlay, fills, submits, and captures the session cookie + expiresAt", async () => {
    const { strategy, pages } = strategyWith();
    const before = Date.now();
    const r = await strategy.authenticate(ctx({ ...BASE_OPTIONS, success_selector: "#welcome" }));
    const session = r.storageState.cookies.find((c) => c.name === "session");
    expect(session).toBeDefined();
    expect(session!.httpOnly).toBe(true);
    // expiresAt derives from the lone real-expiry cookie (the fixture's 1h session).
    expect(r.expiresAt).toBeGreaterThan(before + 3_500_000);
    expect(r.expiresAt).toBeLessThan(before + 3_700_000);
    expect(pages[0]!.events.at(-1)).toBe("close");
  });

  it("supports url_matches as the success marker", async () => {
    const { strategy } = strategyWith();
    const r = await strategy.authenticate(ctx({ ...BASE_OPTIONS, url_matches: "/app$" }));
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
  });

  it("runs fill pre-steps from value_env before the credential fills", async () => {
    const { strategy, pages } = strategyWith({ PRE_FILL_VALUE: "scratch" });
    await strategy.authenticate(
      ctx({
        ...BASE_OPTIONS,
        pre_steps: [
          { action: "click", selector: "#dismiss" },
          { action: "fill", selector: "#user", value_env: "PRE_FILL_VALUE" },
        ],
        success_selector: "#welcome",
      }),
    );
    const fills = pages[0]!.events.filter((e) => e.startsWith("fill:#user"));
    expect(fills).toHaveLength(2); // pre-step fill, then the credential fill wins
  });

  it("fails with a selector-pointing config error on bad credentials — never echoing values", async () => {
    const { strategy } = strategyWith();
    const attempt = strategy.authenticate(
      ctx(
        { ...BASE_OPTIONS, success_selector: "#welcome" },
        { username: FIXTURE_USER, password: "wrong-pass" },
      ),
    );
    await expect(attempt).rejects.toThrow(AuthStrategyConfigError);
    await expect(attempt).rejects.toThrow(/success_selector "#welcome"/);
    await expect(attempt).rejects.not.toThrow(/wrong-pass/);
  });

  it("surfaces the overlay-intercepted click when pre_steps are missing", async () => {
    const { strategy } = strategyWith();
    await expect(
      strategy.authenticate(ctx({ ...BASE_OPTIONS, pre_steps: [], success_selector: "#welcome" })),
    ).rejects.toThrow(/overlay/);
  });

  it("rejects creds without username/password before launching", async () => {
    const { strategy, pages } = strategyWith();
    await expect(
      strategy.authenticate(ctx({ ...BASE_OPTIONS, success_selector: "#welcome" }, {})),
    ).rejects.toThrow(/creds_env must map "username".*"password"/);
    expect(pages).toHaveLength(0);
  });

  it("rejects options with neither success_selector nor url_matches", async () => {
    const { strategy } = strategyWith();
    await expect(strategy.authenticate(ctx(BASE_OPTIONS))).rejects.toThrow(
      /one of success_selector or url_matches/,
    );
  });

  it("rejects a fill pre-step without value_env, and a missing pre-step env var, pre-launch", async () => {
    const { strategy, pages } = strategyWith();
    await expect(
      strategy.authenticate(
        ctx({
          ...BASE_OPTIONS,
          pre_steps: [{ action: "fill", selector: "#user" }],
          success_selector: "#welcome",
        }),
      ),
    ).rejects.toThrow(/needs value_env/);
    await expect(
      strategy.authenticate(
        ctx({
          ...BASE_OPTIONS,
          pre_steps: [{ action: "fill", selector: "#user", value_env: "NOT_SET_ANYWHERE" }],
          success_selector: "#welcome",
        }),
      ),
    ).rejects.toThrow(/\$NOT_SET_ANYWHERE is <UNSET>/);
    expect(pages).toHaveLength(0);
  });
});

describe("ui-form strategy — TOTP hop (server verifies a real RFC-6238 code)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFormLoginServer({ totpSecret: FIXTURE_TOTP_SECRET });
  });
  afterAll(() => server.close());

  const ctx = (options: Record<string, unknown>) => ({
    creds: GOOD_CREDS,
    options,
    baseURL: server.url,
    role: "editor",
  });

  const TOTP_OPTIONS = {
    ...BASE_OPTIONS,
    success_selector: "#welcome",
    totp: {
      secret_env: "UI_FORM_TOTP_SECRET",
      otp_selector: "#otp",
      submit_selector: "#otp-submit",
    },
  };

  it("generates the current code from the secret env var and completes the login", async () => {
    const { strategy } = strategyWith({ UI_FORM_TOTP_SECRET: FIXTURE_TOTP_SECRET });
    const r = await strategy.authenticate(ctx(TOTP_OPTIONS));
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
    expect(r.expiresAt).toBeDefined();
  });

  it("a wrong secret yields a server-rejected code → success-wait config error", async () => {
    const { strategy } = strategyWith({ UI_FORM_TOTP_SECRET: "AAAAAAAAAAAAAAAA" });
    await expect(strategy.authenticate(ctx(TOTP_OPTIONS))).rejects.toThrow(
      /login did not reach success_selector/,
    );
  });

  it("a missing secret env var fails before any browser launches", async () => {
    const { strategy, pages } = strategyWith({});
    await expect(strategy.authenticate(ctx(TOTP_OPTIONS))).rejects.toThrow(
      /totp\.secret_env \$UI_FORM_TOTP_SECRET is <UNSET>/,
    );
    expect(pages).toHaveLength(0);
  });
});

describe.skipIf(!chromiumAvailable)("ui-form strategy — real Chromium via launchAuthPage", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFormLoginServer();
  });
  afterAll(() => server.close());

  it("performs the same overlay-dismiss + form login in a live browser", async () => {
    const strategy = new UiFormStrategy(launchAuthPage, {});
    const r = await strategy.authenticate({
      creds: GOOD_CREDS,
      options: { ...BASE_OPTIONS, success_selector: "#welcome" },
      baseURL: server.url,
      role: "editor",
    });
    expect(r.storageState.cookies.map((c) => c.name)).toContain("session");
    expect(r.expiresAt).toBeDefined();
  }, 60_000);
});
