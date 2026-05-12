import { describe, expect, it } from "vitest";
import {
  AuthStrategyConfigError,
  type InstrumentedBrowser,
  ManualCaptureStrategy,
  NotImplementedStrategyError,
  type StorageState,
  earliestCookieExpiry,
  makeStrategy,
  parseAuthStrategyFile,
  resolveCredsEnv,
} from "../src/auth.js";

const MANUAL_CAPTURE_DESCRIPTOR = `
schema: site-docs/auth-strategy@1
default_role: editor
roles:
  editor:
    strategy: manual-capture
    options: { capture_trigger: console }
    cache: { enabled: true, store: local, ttl: session }
`;

const API_LOGIN_DESCRIPTOR = `
schema: site-docs/auth-strategy@1
default_role: editor
roles:
  editor:
    strategy: api-login
    creds_env: { username: APP_EDITOR_USER, password: APP_EDITOR_PASS }
    options: { login_url: /api/auth/login }
`;

function fakeState(cookieExpiresSec: number): StorageState {
  return {
    cookies: [
      {
        name: "session",
        value: "abc",
        domain: "app.example.test",
        path: "/",
        expires: cookieExpiresSec,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [{ origin: "https://app.example.test", localStorage: [{ name: "tok", value: "xyz" }] }],
  };
}

class FakeBrowser implements InstrumentedBrowser {
  events: string[] = [];
  constructor(private readonly state: StorageState) {}
  async open(baseURL: string) {
    this.events.push(`open:${baseURL}`);
  }
  async waitForCapture(trigger: "console" | "button") {
    this.events.push(`capture:${trigger}`);
  }
  async storageState() {
    this.events.push("storageState");
    return this.state;
  }
  async close() {
    this.events.push("close");
  }
}

describe("parseAuthStrategyFile", () => {
  it("parses a manual-capture descriptor with cache defaults", () => {
    const d = parseAuthStrategyFile(MANUAL_CAPTURE_DESCRIPTOR);
    expect(d.default_role).toBe("editor");
    expect(d.roles.editor!.strategy).toBe("manual-capture");
    expect(d.roles.editor!.cache).toEqual({ enabled: true, store: "local", ttl: "session" });
    expect(d.roles.editor!.creds_env).toEqual({});
  });

  it("rejects a descriptor whose default_role isn't in roles", () => {
    const bad = `schema: site-docs/auth-strategy@1\ndefault_role: nope\nroles: { editor: { strategy: manual-capture } }\n`;
    expect(() => parseAuthStrategyFile(bad)).toThrow(AuthStrategyConfigError);
  });

  it("rejects an unknown strategy name", () => {
    const bad = `schema: site-docs/auth-strategy@1\ndefault_role: e\nroles: { e: { strategy: telepathy } }\n`;
    expect(() => parseAuthStrategyFile(bad)).toThrow(AuthStrategyConfigError);
  });
});

describe("resolveCredsEnv", () => {
  it("reads credential values from the provided env map", () => {
    const d = parseAuthStrategyFile(API_LOGIN_DESCRIPTOR);
    const creds = resolveCredsEnv(d.roles.editor!, { APP_EDITOR_USER: "u", APP_EDITOR_PASS: "p" });
    expect(creds).toEqual({ username: "u", password: "p" });
  });
  it("throws listing the missing env vars", () => {
    const d = parseAuthStrategyFile(API_LOGIN_DESCRIPTOR);
    expect(() => resolveCredsEnv(d.roles.editor!, {})).toThrow(/APP_EDITOR_USER/);
  });
});

describe("makeStrategy", () => {
  it("builds manual-capture when given a browser factory", () => {
    const d = parseAuthStrategyFile(MANUAL_CAPTURE_DESCRIPTOR);
    const s = makeStrategy(d.roles.editor!, { instrumentedBrowser: () => new FakeBrowser(fakeState(-1)) });
    expect(s).toBeInstanceOf(ManualCaptureStrategy);
  });
  it("throws if manual-capture has no browser factory", () => {
    const d = parseAuthStrategyFile(MANUAL_CAPTURE_DESCRIPTOR);
    expect(() => makeStrategy(d.roles.editor!, {})).toThrow(AuthStrategyConfigError);
  });
  it("throws NotImplementedStrategyError for unbuilt strategies", () => {
    const d = parseAuthStrategyFile(API_LOGIN_DESCRIPTOR);
    expect(() => makeStrategy(d.roles.editor!, {})).toThrow(NotImplementedStrategyError);
  });
});

describe("ManualCaptureStrategy", () => {
  it("opens, waits for capture, snapshots storageState, and closes — in order", async () => {
    const browser = new FakeBrowser(fakeState(-1));
    const s = new ManualCaptureStrategy(() => browser);
    const r = await s.authenticate({ creds: {}, options: { capture_trigger: "console" }, baseURL: "https://app.example.test", role: "editor" });
    expect(r.storageState.cookies).toHaveLength(1);
    expect(browser.events).toEqual(["open:https://app.example.test", "capture:console", "storageState", "close"]);
  });

  it("reports expiresAt from the earliest non-session cookie", async () => {
    const oneHour = Math.floor(Date.now() / 1000) + 3600;
    const s = new ManualCaptureStrategy(() => new FakeBrowser(fakeState(oneHour)));
    const r = await s.authenticate({ creds: {}, options: {}, baseURL: "https://x", role: "editor" });
    expect(r.expiresAt).toBe(oneHour * 1000);
  });
});

describe("earliestCookieExpiry", () => {
  it("ignores session cookies (expires <= 0)", () => {
    expect(earliestCookieExpiry(fakeState(-1))).toBeUndefined();
  });
});
