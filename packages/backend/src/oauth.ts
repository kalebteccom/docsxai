// Minimal OAuth 2.1 authorization server: authorization-code + PKCE (S256 only), rotating refresh
// tokens. Stub-grade by design — consent is auto-approved for callers that present the CI bearer
// token (or SITE_DOCS_OAUTH_AUTO_APPROVE=1); a real consent UI is hosted-deployment scope.
//
// Secret hygiene: codes and tokens are random 32-byte values handed to the client once; the server
// retains only their sha256 hashes. Nothing in this module logs or throws a secret value.

import { createHash, randomBytes } from "node:crypto";

export const AUTH_CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_S = 3600;

export interface OAuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}

/** `code` maps to the OAuth error code returned in the response body. */
export class OAuthError extends Error {
  constructor(
    readonly code: "invalid_request" | "invalid_grant" | "unsupported_grant_type",
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

interface CodeEntry {
  challenge: string;
  redirectUri: string;
  expiresAt: number;
  /** Workspace id the grant is scoped to; null = all workspaces (today's stub semantics). */
  scope: string | null;
}

const hash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

export class OAuthIssuer {
  private codes = new Map<string, CodeEntry>();
  private accessTokens = new Map<string, { expiresAt: number; scope: string | null }>();
  private refreshTokens = new Map<string, { scope: string | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Mint a single-use authorization code bound to the PKCE challenge + redirect URI. */
  issueCode(opts: { challenge: string; redirectUri: string; scope?: string | null }): string {
    const code = randomBytes(32).toString("base64url");
    this.codes.set(hash(code), {
      challenge: opts.challenge,
      redirectUri: opts.redirectUri,
      expiresAt: this.now() + AUTH_CODE_TTL_MS,
      scope: opts.scope ?? null,
    });
    return code;
  }

  /** Exchange a code + PKCE verifier for tokens. Codes are single-use — even a failed attempt burns one. */
  exchangeCode(opts: { code: string; verifier: string; redirectUri?: string }): OAuthTokens {
    const key = hash(opts.code);
    const entry = this.codes.get(key);
    this.codes.delete(key);
    if (!entry || entry.expiresAt <= this.now()) {
      throw new OAuthError("invalid_grant", "unknown, used, or expired authorization code");
    }
    if (opts.redirectUri !== undefined && opts.redirectUri !== entry.redirectUri) {
      throw new OAuthError(
        "invalid_grant",
        "redirect_uri does not match the authorization request",
      );
    }
    const computed = createHash("sha256").update(opts.verifier).digest("base64url");
    if (computed !== entry.challenge) {
      throw new OAuthError("invalid_grant", "PKCE verification failed (code_verifier mismatch)");
    }
    return this.issueTokens(entry.scope);
  }

  /** Rotate a refresh token: the presented token is invalidated and a fresh pair is issued. */
  refresh(refreshToken: string): OAuthTokens {
    const key = hash(refreshToken);
    const entry = this.refreshTokens.get(key);
    if (!entry) {
      throw new OAuthError("invalid_grant", "unknown or already-rotated refresh token");
    }
    this.refreshTokens.delete(key);
    return this.issueTokens(entry.scope);
  }

  /** True when the bearer value is a live (issued, unexpired) access token. */
  isLiveAccessToken(token: string): boolean {
    const entry = this.accessTokens.get(hash(token));
    return !!entry && entry.expiresAt > this.now();
  }

  private issueTokens(scope: string | null): OAuthTokens {
    const access = randomBytes(32).toString("base64url");
    const refresh = randomBytes(32).toString("base64url");
    this.accessTokens.set(hash(access), {
      expiresAt: this.now() + ACCESS_TOKEN_TTL_S * 1000,
      scope,
    });
    this.refreshTokens.set(hash(refresh), { scope });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refresh,
    };
  }
}

/** OAuth 2.1 loopback-only redirect policy: plain-http redirect URIs on a loopback host. */
export function isLoopbackRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
}
