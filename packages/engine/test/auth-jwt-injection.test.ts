import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStrategyConfigError, JwtInjectionStrategy, decodeJwtPayload } from "../src/auth.js";
import {
  FIXTURE_CLIENT_ID,
  FIXTURE_CLIENT_SECRET,
  makeFixtureJwt,
  startTokenServer,
  type FixtureServer,
} from "./fixtures/auth-servers.js";

const BASE_URL = "https://app.example.test";
const INJECT_LS = { localStorage: [{ key: "auth_token", value_template: "Bearer {{token}}" }] };

describe("jwt-injection — static token from env", () => {
  const EXP_SEC = Math.floor(Date.now() / 1000) + 1800;
  const STATIC_TOKEN = makeFixtureJwt({ sub: "u1", exp: EXP_SEC });

  function strategy(env: Record<string, string>) {
    return new JwtInjectionStrategy(fetch, env);
  }

  it("injects the rendered template into localStorage for the baseURL origin", async () => {
    const r = await strategy({ APP_JWT: STATIC_TOKEN }).authenticate({
      creds: {},
      options: { token_env: "APP_JWT", inject: INJECT_LS },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.storageState.origins).toEqual([
      {
        origin: "https://app.example.test",
        localStorage: [{ name: "auth_token", value: `Bearer ${STATIC_TOKEN}` }],
      },
    ]);
    expect(r.storageState.cookies).toEqual([]);
  });

  it("derives expiresAt from the JWT exp claim (no verification)", async () => {
    const r = await strategy({ APP_JWT: STATIC_TOKEN }).authenticate({
      creds: {},
      options: { token_env: "APP_JWT", inject: INJECT_LS },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.expiresAt).toBe(EXP_SEC * 1000);
  });

  it("injects cookies with defaults from the baseURL and the token expiry", async () => {
    const r = await strategy({ APP_JWT: STATIC_TOKEN }).authenticate({
      creds: {},
      options: {
        token_env: "APP_JWT",
        inject: { cookies: [{ name: "jwt", value_template: "{{token}}", path: "/api" }] },
      },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.storageState.cookies).toEqual([
      {
        name: "jwt",
        value: STATIC_TOKEN,
        domain: "app.example.test",
        path: "/api",
        expires: EXP_SEC,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  });

  it("reports an unset token env var as <UNSET> without naming any value", async () => {
    await expect(
      strategy({}).authenticate({
        creds: {},
        options: { token_env: "APP_JWT", inject: INJECT_LS },
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/\$APP_JWT is <UNSET>/);
  });

  it("requires exactly one token source and at least one injection target", async () => {
    await expect(
      strategy({ APP_JWT: STATIC_TOKEN }).authenticate({
        creds: {},
        options: { token_env: "APP_JWT", token_url: "/token", inject: INJECT_LS },
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(AuthStrategyConfigError);
    await expect(
      strategy({ APP_JWT: STATIC_TOKEN }).authenticate({
        creds: {},
        options: { token_env: "APP_JWT", inject: {} },
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/at least one/);
  });
});

describe("jwt-injection — client-credentials grant", () => {
  let tokenServer: FixtureServer;
  let noExpiresServer: FixtureServer;
  beforeAll(async () => {
    tokenServer = await startTokenServer();
    noExpiresServer = await startTokenServer({ expiresInBody: false });
  });
  afterAll(async () => {
    await tokenServer.close();
    await noExpiresServer.close();
  });

  const CREDS = { client_id: FIXTURE_CLIENT_ID, client_secret: FIXTURE_CLIENT_SECRET };

  it("exchanges client credentials for a token and injects it", async () => {
    const r = await new JwtInjectionStrategy().authenticate({
      creds: CREDS,
      options: { token_url: `${tokenServer.url}/token`, inject: INJECT_LS },
      baseURL: BASE_URL,
      role: "editor",
    });
    const entry = r.storageState.origins[0]!.localStorage[0]!;
    expect(entry.name).toBe("auth_token");
    expect(entry.value).toMatch(/^Bearer .+\..+\./);
    // expires_in: 3600 from the fixture.
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(r.expiresAt).toBeLessThan(Date.now() + 3_700_000);
  });

  it("falls back to the JWT exp claim when the body has no expires_in", async () => {
    const r = await new JwtInjectionStrategy().authenticate({
      creds: CREDS,
      options: { token_url: `${noExpiresServer.url}/token`, inject: INJECT_LS },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("a rejected grant reports the status and masks the client_secret", async () => {
    const err = await new JwtInjectionStrategy()
      .authenticate({
        creds: { client_id: FIXTURE_CLIENT_ID, client_secret: "wrong-client-secret" },
        options: { token_url: `${tokenServer.url}/token`, inject: INJECT_LS },
        baseURL: BASE_URL,
        role: "editor",
      })
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(AuthStrategyConfigError);
    expect(err!.message).toContain("401");
    expect(err!.message).toContain("<SET>");
    expect(err!.message).not.toContain("wrong-client-secret");
  });

  it("missing client creds fail fast with masked diagnostics", async () => {
    await expect(
      new JwtInjectionStrategy().authenticate({
        creds: { client_id: FIXTURE_CLIENT_ID },
        options: { token_url: `${tokenServer.url}/token`, inject: INJECT_LS },
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/client_secret \(<UNSET>\)/);
  });
});

describe("decodeJwtPayload", () => {
  it("decodes the middle segment without verifying", () => {
    expect(decodeJwtPayload(makeFixtureJwt({ exp: 123, sub: "x" }))).toEqual({
      exp: 123,
      sub: "x",
    });
  });
  it("returns undefined for non-JWT strings", () => {
    expect(decodeJwtPayload("opaque-token")).toBeUndefined();
    expect(decodeJwtPayload("a.not-base64-json.c")).toBeUndefined();
  });
});
