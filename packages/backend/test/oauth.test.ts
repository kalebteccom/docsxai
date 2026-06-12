import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createBackendStub } from "../src/index.js";
import { ACCESS_TOKEN_TTL_S, AUTH_CODE_TTL_MS, OAuthError, OAuthIssuer } from "../src/oauth.js";

const TOKEN = "ci-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
});
afterEach(() => {
  delete process.env.SITE_DOCS_OAUTH_AUTO_APPROVE;
});

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeUrl(challenge: string, overrides: Record<string, string> = {}): string {
  const u = new URL(`${base}/v1/oauth/authorize`);
  const params: Record<string, string> = {
    client_id: "site-docs-cli",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: "http://127.0.0.1:39999/callback",
    state: "st4te",
    ...overrides,
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function authorize(
  challenge: string,
  opts: { bearer?: string; overrides?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(authorizeUrl(challenge, opts.overrides ?? {}), {
    redirect: "manual",
    ...(opts.bearer ? { headers: { authorization: `Bearer ${opts.bearer}` } } : {}),
  });
}

async function exchange(form: Record<string, string>): Promise<Response> {
  return fetch(`${base}/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

function codeFromLocation(res: Response): { code: string; state: string | null } {
  const loc = new URL(res.headers.get("location")!);
  return { code: loc.searchParams.get("code")!, state: loc.searchParams.get("state") };
}

describe("authorize endpoint", () => {
  it("302s with code + state when the caller presents the CI bearer token", async () => {
    const { challenge } = pkcePair();
    const res = await authorize(challenge, { bearer: TOKEN });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("http://127.0.0.1:39999");
    expect(loc.pathname).toBe("/callback");
    expect(loc.searchParams.get("code")).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("st4te");
  });

  it("302s under SITE_DOCS_OAUTH_AUTO_APPROVE=1 without a bearer", async () => {
    process.env.SITE_DOCS_OAUTH_AUTO_APPROVE = "1";
    const { challenge } = pkcePair();
    const res = await authorize(challenge);
    expect(res.status).toBe(302);
  });

  it("403s without approval (no bearer, no auto-approve)", async () => {
    const { challenge } = pkcePair();
    const res = await authorize(challenge);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("consent_required");
  });

  it("403s with a wrong bearer token", async () => {
    const { challenge } = pkcePair();
    expect((await authorize(challenge, { bearer: "wrong" })).status).toBe(403);
  });

  it("400s an unknown client_id", async () => {
    const { challenge } = pkcePair();
    const res = await authorize(challenge, { bearer: TOKEN, overrides: { client_id: "evil" } });
    expect(res.status).toBe(400);
  });

  it("400s a missing challenge or a non-S256 method", async () => {
    const { challenge } = pkcePair();
    expect((await authorize("", { bearer: TOKEN, overrides: { code_challenge: "" } })).status).toBe(
      400,
    );
    expect(
      (
        await authorize(challenge, {
          bearer: TOKEN,
          overrides: { code_challenge_method: "plain" },
        })
      ).status,
    ).toBe(400);
  });

  it("400s non-loopback redirect URIs", async () => {
    const { challenge } = pkcePair();
    for (const redirect_uri of [
      "https://evil.example/callback",
      "http://evil.example/callback",
      "not-a-url",
    ]) {
      const res = await authorize(challenge, { bearer: TOKEN, overrides: { redirect_uri } });
      expect(res.status).toBe(400);
    }
  });
});

describe("token endpoint + the full PKCE handshake", () => {
  it("exchanges a code + verifier for tokens that authorize API calls", async () => {
    const { verifier, challenge } = pkcePair();
    const { code, state } = codeFromLocation(await authorize(challenge, { bearer: TOKEN }));
    expect(state).toBe("st4te");

    const res = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:39999/callback",
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // The issued access token passes the auth gate even though it isn't the CI token.
    const authed = await fetch(`${base}/v1/workspaces`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(authed.status).toBe(200);
  });

  it("rejects a wrong verifier and burns the code (single-use)", async () => {
    const { challenge, verifier } = pkcePair();
    const { code } = codeFromLocation(await authorize(challenge, { bearer: TOKEN }));

    const bad = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier",
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_grant");

    // The failed attempt consumed the code — the correct verifier no longer works.
    const reuse = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    });
    expect(reuse.status).toBe(400);
  });

  it("rejects a redirect_uri that differs from the authorization request", async () => {
    const { challenge, verifier } = pkcePair();
    const { code } = codeFromLocation(await authorize(challenge, { bearer: TOKEN }));
    const res = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:40000/other",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a code after a successful exchange (single-use)", async () => {
    const { challenge, verifier } = pkcePair();
    const { code } = codeFromLocation(await authorize(challenge, { bearer: TOKEN }));
    expect(
      (await exchange({ grant_type: "authorization_code", code, code_verifier: verifier })).status,
    ).toBe(200);
    expect(
      (await exchange({ grant_type: "authorization_code", code, code_verifier: verifier })).status,
    ).toBe(400);
  });

  it("rotates refresh tokens; the rotated-out token is rejected", async () => {
    const { challenge, verifier } = pkcePair();
    const { code } = codeFromLocation(await authorize(challenge, { bearer: TOKEN }));
    const first = (await (
      await exchange({ grant_type: "authorization_code", code, code_verifier: verifier })
    ).json()) as { access_token: string; refresh_token: string };

    const rotated = await exchange({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    });
    expect(rotated.status).toBe(200);
    const second = (await rotated.json()) as { access_token: string; refresh_token: string };
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // Re-using the old refresh token must fail (rotation invalidates it).
    const reuse = await exchange({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");

    // The new access token works.
    const authed = await fetch(`${base}/v1/workspaces`, {
      headers: { authorization: `Bearer ${second.access_token}` },
    });
    expect(authed.status).toBe(200);
  });

  it("400s missing params and unsupported grant types", async () => {
    expect((await exchange({ grant_type: "authorization_code" })).status).toBe(400);
    expect((await exchange({ grant_type: "refresh_token" })).status).toBe(400);
    const r = await exchange({ grant_type: "client_credentials" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });
});

describe("auth middleware", () => {
  it("401s with WWW-Authenticate on an unknown bearer", async () => {
    const res = await fetch(`${base}/v1/workspaces`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("401s with WWW-Authenticate when no token is sent", async () => {
    const res = await fetch(`${base}/v1/workspaces`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });
});

describe("OAuthIssuer clock-driven expiry", () => {
  it("rejects an expired authorization code", () => {
    let now = 1_000_000;
    const issuer = new OAuthIssuer(() => now);
    const { verifier, challenge } = pkcePair();
    const code = issuer.issueCode({ challenge, redirectUri: "http://127.0.0.1:1/cb" });
    now += AUTH_CODE_TTL_MS + 1;
    expect(() => issuer.exchangeCode({ code, verifier })).toThrow(OAuthError);
  });

  it("expires access tokens after their TTL", () => {
    let now = 1_000_000;
    const issuer = new OAuthIssuer(() => now);
    const { verifier, challenge } = pkcePair();
    const code = issuer.issueCode({ challenge, redirectUri: "http://127.0.0.1:1/cb" });
    const tokens = issuer.exchangeCode({ code, verifier });
    expect(issuer.isLiveAccessToken(tokens.access_token)).toBe(true);
    now += ACCESS_TOKEN_TTL_S * 1000 + 1;
    expect(issuer.isLiveAccessToken(tokens.access_token)).toBe(false);
    // ...but the refresh grant still rotates a fresh pair.
    const rotated = issuer.refresh(tokens.refresh_token);
    expect(issuer.isLiveAccessToken(rotated.access_token)).toBe(true);
  });
});
