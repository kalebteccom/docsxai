import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiLoginStrategy,
  AuthStrategyConfigError,
  type InstrumentedBrowser,
  LocalStorageStateCache,
  ManualCaptureStrategy,
  type StorageState,
  cookieExpiryByName,
  earliestCookieExpiry,
  makeStrategy,
  parseAuthStrategyFile,
  resolveCreds,
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
    origins: [
      { origin: "https://app.example.test", localStorage: [{ name: "tok", value: "xyz" }] },
    ],
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

describe("resolveCreds — user pools", () => {
  const role = () => parseAuthStrategyFile(API_LOGIN_DESCRIPTOR).roles.editor!;
  const POOL_ENV = {
    APP_EDITOR_USER: "u0, u1 ,u2",
    APP_EDITOR_PASS: "p0,p1,p2",
  };

  it("each worker picks pool[workerIndex % len] consistently across every pooled var", () => {
    expect(resolveCreds(role(), { workerIndex: 0, env: POOL_ENV })).toEqual({
      username: "u0",
      password: "p0",
    });
    expect(resolveCreds(role(), { workerIndex: 2, env: POOL_ENV })).toEqual({
      username: "u2",
      password: "p2",
    });
  });

  it("wraps around the pool when workerIndex exceeds its size", () => {
    expect(resolveCreds(role(), { workerIndex: 4, env: POOL_ENV })).toEqual({
      username: "u1",
      password: "p1",
    });
  });

  it("leaves single-value creds untouched regardless of workerIndex — even with commas elsewhere", () => {
    const env = { APP_EDITOR_USER: "u0,u1", APP_EDITOR_PASS: "shared-pass" };
    expect(resolveCreds(role(), { workerIndex: 1, env })).toEqual({
      username: "u1",
      password: "shared-pass",
    });
  });

  it("defaults workerIndex to 0", () => {
    expect(resolveCreds(role(), { env: POOL_ENV }).username).toBe("u0");
  });

  it("still reports missing env vars by name", () => {
    expect(() => resolveCreds(role(), { env: {} })).toThrow(/APP_EDITOR_PASS/);
  });
});

describe("makeStrategy", () => {
  it("builds manual-capture when given a browser factory", () => {
    const d = parseAuthStrategyFile(MANUAL_CAPTURE_DESCRIPTOR);
    const s = makeStrategy(d.roles.editor!, {
      instrumentedBrowser: () => new FakeBrowser(fakeState(-1)),
    });
    expect(s).toBeInstanceOf(ManualCaptureStrategy);
  });
  it("throws if manual-capture has no browser factory", () => {
    const d = parseAuthStrategyFile(MANUAL_CAPTURE_DESCRIPTOR);
    expect(() => makeStrategy(d.roles.editor!, {})).toThrow(AuthStrategyConfigError);
  });
  it("builds api-login without extra deps", () => {
    const d = parseAuthStrategyFile(API_LOGIN_DESCRIPTOR);
    expect(makeStrategy(d.roles.editor!, {})).toBeInstanceOf(ApiLoginStrategy);
  });
});

describe("ManualCaptureStrategy", () => {
  it("opens, waits for capture, snapshots storageState, and closes — in order", async () => {
    const browser = new FakeBrowser(fakeState(-1));
    const s = new ManualCaptureStrategy(() => browser);
    const r = await s.authenticate({
      creds: {},
      options: { capture_trigger: "console" },
      baseURL: "https://app.example.test",
      role: "editor",
    });
    expect(r.storageState.cookies).toHaveLength(1);
    expect(browser.events).toEqual([
      "open:https://app.example.test",
      "capture:console",
      "storageState",
      "close",
    ]);
  });

  it("does not report an expiresAt (the cache's ttl / auth_cookie is the contract, not raw cookie expiry)", async () => {
    const s = new ManualCaptureStrategy(
      () => new FakeBrowser(fakeState(Math.floor(Date.now() / 1000) + 3600)),
    );
    const r = await s.authenticate({
      creds: {},
      options: {},
      baseURL: "https://x",
      role: "editor",
    });
    expect(r.expiresAt).toBeUndefined();
  });
});

describe("cookie expiry helpers", () => {
  it("earliestCookieExpiry ignores session cookies (expires <= 0)", () => {
    expect(earliestCookieExpiry(fakeState(-1))).toBeUndefined();
  });
  it("cookieExpiryByName returns the named cookie's expiry, or undefined for absent/session cookies", () => {
    const sec = Math.floor(Date.now() / 1000) + 3600;
    expect(cookieExpiryByName(fakeState(sec), "session")).toBe(sec * 1000);
    expect(cookieExpiryByName(fakeState(sec), "nonexistent")).toBeUndefined();
    expect(cookieExpiryByName(fakeState(-1), "session")).toBeUndefined();
  });
});

describe("LocalStorageStateCache — expiry priority: auth_cookie > ttl > default", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-cache-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const now = 1_700_000_000_000;
  const roleAuth = (cache: Record<string, unknown>) =>
    parseAuthStrategyFile(
      `schema: site-docs/auth-strategy@1\ndefault_role: editor\nroles: { editor: { strategy: manual-capture, cache: ${JSON.stringify(cache)} } }`,
    ).roles.editor!;

  it("uses the auth_cookie's real expiry when set and present — ignoring ttl entirely", async () => {
    const cache = new LocalStorageStateCache(path.join(dir, ".auth"));
    const cookieSec = Math.floor(now / 1000) + 7200; // 2h out
    const r = await cache.save(
      "editor",
      { storageState: fakeState(cookieSec) },
      roleAuth({ enabled: true, store: "local", ttl: "1h", auth_cookie: "session" }),
      now,
    );
    expect(r.expiresAt).toBe(cookieSec * 1000);
    expect(r.source).toMatch(/auth-cookie "session"/);
    expect(await cache.load("editor", now + 1000)).not.toBeNull(); // valid right after capture
  });

  it("an --auth-cookie override beats the descriptor's auth_cookie", async () => {
    const cache = new LocalStorageStateCache(path.join(dir, ".auth"));
    const cookieSec = Math.floor(now / 1000) + 3600;
    const r = await cache.save(
      "editor",
      { storageState: fakeState(cookieSec) },
      roleAuth({ enabled: true, store: "local", ttl: "session", auth_cookie: "wrongName" }),
      now,
      { authCookie: "session" },
    );
    expect(r.expiresAt).toBe(cookieSec * 1000);
  });

  it("falls back to ttl when auth_cookie is set but the cookie is absent / session-only", async () => {
    const cache = new LocalStorageStateCache(path.join(dir, ".auth"));
    const r1 = await cache.save(
      "editor",
      { storageState: fakeState(-1) },
      roleAuth({ enabled: true, store: "local", ttl: "1h", auth_cookie: "session" }),
      now,
    );
    expect(r1.expiresAt).toBe(now + 3_600_000);
    expect(r1.source).toMatch(/ttl/);
    const r2 = await cache.save(
      "editor",
      { storageState: fakeState(-1) },
      roleAuth({ enabled: true, store: "local", ttl: "30m", auth_cookie: "nope" }),
      now,
    );
    expect(r2.expiresAt).toBe(now + 1_800_000);
  });

  it("uses ttl when no auth_cookie is set — NOT the raw cookie min (this was the AAD-SSO blocker)", async () => {
    const cache = new LocalStorageStateCache(path.join(dir, ".auth"));
    // a near-now strategy-reported expiresAt (as old code would compute from min(cookie.expires)) must NOT win
    const r = await cache.save(
      "editor",
      { storageState: fakeState(-1), expiresAt: now + 2300 },
      roleAuth({ enabled: true, store: "local", ttl: "1h" }),
      now,
    );
    expect(r.expiresAt).toBe(now + 3_600_000);
    expect(r.source).toBe("ttl");
  });

  it("ttl: session with no usable expiry → 1h default", async () => {
    const cache = new LocalStorageStateCache(path.join(dir, ".auth"));
    const r = await cache.save(
      "editor",
      { storageState: fakeState(-1) },
      roleAuth({ enabled: true, store: "local", ttl: "session" }),
      now,
    );
    expect(r.expiresAt).toBe(now + 3_600_000);
    expect(r.source).toBe("1h default");
  });
});
