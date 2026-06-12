// webauthn strategy — ordering + error paths through a recording fake page, and a Chromium-gated
// check that the real launcher attaches a CDP virtual authenticator. The full create/get passkey
// ceremony needs a WebAuthn relying-party fixture (challenge issuance + attestation verification)
// and is flaky under headless CI, so it is intentionally not exercised here (skipIf-gated tests
// cover attachment; the unit fakes cover the strategy's choreography and failure modes).

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthStrategyConfigError,
  WebauthnStrategy,
  launchAuthPage,
  type AuthPage,
  type StorageState,
} from "../src/auth.js";
import { startFormLoginServer, type FixtureServer } from "./fixtures/auth-servers.js";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const AUTHED_STATE: StorageState = {
  cookies: [
    {
      name: "session",
      value: "fixture",
      domain: "app.example.test",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
  origins: [],
};

class RecordingPage implements AuthPage {
  events: string[] = [];
  constructor(private readonly loginSucceeds = true) {}
  async goto(url: string) {
    this.events.push(`goto:${url}`);
  }
  async fill(selector: string, _value: string) {
    this.events.push(`fill:${selector}`);
  }
  async click(selector: string) {
    this.events.push(`click:${selector}`);
  }
  async waitForSelector(selector: string) {
    this.events.push(`wait:${selector}`);
    if (!this.loginSucceeds) throw new Error("timeout");
  }
  async waitForUrl(pattern: RegExp) {
    this.events.push(`wait-url:${pattern.source}`);
    if (!this.loginSucceeds) throw new Error("timeout");
  }
  async enableVirtualAuthenticator() {
    this.events.push("virtual-authenticator");
  }
  async storageState() {
    this.events.push("storageState");
    return AUTHED_STATE;
  }
  async close() {
    this.events.push("close");
  }
}

const OPTIONS = {
  login_url: "/login",
  trigger_selector: "#passkey",
  success_selector: "#welcome",
};

function ctx(options: Record<string, unknown>, creds: Record<string, string> = {}) {
  return { creds, options, baseURL: "https://app.example.test", role: "editor" };
}

describe("webauthn strategy — choreography on a fake page", () => {
  it("attaches the virtual authenticator BEFORE navigation, then trigger → success → snapshot", async () => {
    const page = new RecordingPage();
    const r = await new WebauthnStrategy(async () => page, {}).authenticate(ctx(OPTIONS));
    expect(page.events).toEqual([
      "virtual-authenticator",
      "goto:https://app.example.test/login",
      "click:#passkey",
      "wait:#welcome",
      "storageState",
      "close",
    ]);
    expect(r.storageState.cookies[0]!.name).toBe("session");
    expect(r.expiresAt).toBeDefined(); // derived from the lone real-expiry cookie
  });

  it("fills username_selector from creds (username-first flows) and runs pre_steps", async () => {
    const page = new RecordingPage();
    await new WebauthnStrategy(async () => page, { LOCALE: "en" }).authenticate(
      ctx(
        {
          ...OPTIONS,
          username_selector: "#user",
          pre_steps: [{ action: "fill", selector: "#locale", value_env: "LOCALE" }],
        },
        { username: "alice" },
      ),
    );
    expect(page.events.slice(0, 5)).toEqual([
      "virtual-authenticator",
      "goto:https://app.example.test/login",
      "fill:#locale",
      "fill:#user",
      "click:#passkey",
    ]);
  });

  it("times out into a config error naming the success marker — page still closed", async () => {
    const page = new RecordingPage(false);
    const attempt = new WebauthnStrategy(async () => page, {}).authenticate(ctx(OPTIONS));
    await expect(attempt).rejects.toThrow(AuthStrategyConfigError);
    await expect(attempt).rejects.toThrow(/webauthn: login did not reach success_selector/);
    expect(page.events.at(-1)).toBe("close");
  });

  it("requires a username credential when username_selector is set — before launching", async () => {
    let launched = false;
    const s = new WebauthnStrategy(async () => {
      launched = true;
      return new RecordingPage();
    }, {});
    await expect(s.authenticate(ctx({ ...OPTIONS, username_selector: "#user" }))).rejects.toThrow(
      /creds_env must map "username" \(<UNSET>\)/,
    );
    expect(launched).toBe(false);
  });

  it("rejects options missing trigger_selector or a success marker", async () => {
    const s = new WebauthnStrategy(async () => new RecordingPage(), {});
    await expect(
      s.authenticate(ctx({ login_url: "/login", success_selector: "#welcome" })),
    ).rejects.toThrow(/trigger_selector/);
    await expect(
      s.authenticate(ctx({ login_url: "/login", trigger_selector: "#passkey" })),
    ).rejects.toThrow(/one of success_selector or url_matches/);
  });
});

describe.skipIf(!chromiumAvailable)("webauthn strategy — real CDP virtual authenticator", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFormLoginServer();
  });
  afterAll(() => server.close());

  it("attaches a ctap2/internal virtual authenticator to a live page without error", async () => {
    const page = await launchAuthPage({ baseURL: server.url });
    try {
      await page.enableVirtualAuthenticator();
      await page.goto("/login");
      await page.waitForSelector("#submit", { timeoutMs: 10_000 });
    } finally {
      await page.close();
    }
  }, 60_000);
});
