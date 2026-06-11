import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiLoginStrategy, AuthStrategyConfigError, getJsonPath } from "../src/auth.js";
import {
  FIXTURE_PASS,
  FIXTURE_USER,
  startJsonLoginServer,
  type FixtureServer,
} from "./fixtures/auth-servers.js";

let server: FixtureServer;
beforeAll(async () => {
  server = await startJsonLoginServer();
});
afterAll(() => server.close());

const GOOD_CREDS = { username: FIXTURE_USER, password: FIXTURE_PASS };

function ctx(options: Record<string, unknown>, creds: Record<string, string> = GOOD_CREDS) {
  return { creds, options, baseURL: server.url, role: "editor" };
}

describe("api-login strategy", () => {
  it("logs in with a JSON body, collecting cookies across the redirect chain", async () => {
    const r = await new ApiLoginStrategy().authenticate(
      ctx({ login_url: "/login", success_check: { cookie: "sid" } }),
    );
    const names = r.storageState.cookies.map((c) => c.name);
    expect(names).toContain("sid");
    expect(names).toContain("pre");
    expect(r.storageState.origins).toEqual([]);
    const sid = r.storageState.cookies.find((c) => c.name === "sid")!;
    expect(sid.domain).toBe("127.0.0.1");
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe("Lax");
  });

  it("resolves login_url relative to baseURL and supports form encoding", async () => {
    const r = await new ApiLoginStrategy().authenticate(
      ctx({ login_url: "/login-direct", body_format: "form", success_check: { cookie: "sid" } }),
    );
    expect(r.storageState.cookies.map((c) => c.name)).toEqual(["sid"]);
  });

  it("reports expiresAt from the success cookie's expiry", async () => {
    const before = Date.now();
    const r = await new ApiLoginStrategy().authenticate(
      ctx({ login_url: "/login-direct", success_check: { cookie: "sid" } }),
    );
    expect(r.expiresAt).toBeGreaterThan(before + 3_500_000);
    expect(r.expiresAt).toBeLessThan(before + 3_700_000);
  });

  it("success_check.status passes and fails on the final status", async () => {
    await expect(
      new ApiLoginStrategy().authenticate(
        ctx({ login_url: "/login", success_check: { status: 200 } }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      new ApiLoginStrategy().authenticate(
        ctx({ login_url: "/login", success_check: { status: 204 } }),
      ),
    ).rejects.toThrow(/expected status 204 .* got 200/);
  });

  it("success_check.json_path compares the value at the dotted path", async () => {
    await expect(
      new ApiLoginStrategy().authenticate(
        ctx({
          login_url: "/login",
          success_check: { json_path: "user.name", equals: FIXTURE_USER },
        }),
      ),
    ).resolves.toBeTruthy();
    await expect(
      new ApiLoginStrategy().authenticate(
        ctx({ login_url: "/login", success_check: { json_path: "user.name", equals: "mallory" } }),
      ),
    ).rejects.toThrow(/json_path "user\.name"/);
  });

  it("default success check rejects a 4xx final status", async () => {
    await expect(
      new ApiLoginStrategy().authenticate(
        ctx({ login_url: "/login" }, { username: FIXTURE_USER, password: "wrong" }),
      ),
    ).rejects.toThrow(/answered 401/);
  });

  it("missing success cookie fails, naming the cookie but never the credentials", async () => {
    const err = await new ApiLoginStrategy()
      .authenticate(ctx({ login_url: "/login", success_check: { cookie: "nonexistent" } }))
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(AuthStrategyConfigError);
    expect(err!.message).toContain('"nonexistent"');
    expect(err!.message).not.toContain(FIXTURE_PASS);
  });

  it("login failures never leak the password value", async () => {
    const err = await new ApiLoginStrategy()
      .authenticate(
        ctx({ login_url: "/login" }, { username: FIXTURE_USER, password: "wrong-pass" }),
      )
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err!.message).not.toContain("wrong-pass");
  });

  it("rejects unknown option keys with a config error", async () => {
    await expect(
      new ApiLoginStrategy().authenticate(ctx({ login_url: "/login", logn_url_typo: true })),
    ).rejects.toThrow(AuthStrategyConfigError);
  });

  it("requires login_url", async () => {
    await expect(new ApiLoginStrategy().authenticate(ctx({}))).rejects.toThrow(/login_url/);
  });
});

describe("getJsonPath", () => {
  it("walks nested objects and returns undefined for misses", () => {
    expect(getJsonPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
    expect(getJsonPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getJsonPath(null, "a")).toBeUndefined();
  });
});
