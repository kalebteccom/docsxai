// OAuth 2.1 HTTP handlers for the backend stub: the /v1/oauth/authorize redirect endpoint and the
// /v1/oauth/token grant endpoint. Both are pulled out of the server closure and take an explicit
// context ({ oauth, isCiToken }) so the only state they touch is passed in — the rest is pure
// plumbing imported from http.js. Keeps the issuer logic (PKCE checks, consent gate, grant
// dispatch) in one place without entangling it with route-table wiring.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { JSON_BODY_LIMIT_BYTES, OAUTH_CLIENT_ID } from "./api.js";
import { bearerToken, readBody, sendJson } from "./http.js";
import { isLoopbackRedirectUri, OAuthError, type OAuthIssuer } from "./oauth.js";

/** State the OAuth handlers need from the server: the issuer and the CI-token predicate. */
export interface OAuthHttpContext {
  oauth: OAuthIssuer;
  isCiToken: (token: string) => boolean;
}

export function handleAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: OAuthHttpContext,
): void {
  const { oauth, isCiToken } = ctx;
  const q = url.searchParams;
  const bad = (message: string) => sendJson(res, 400, { error: "invalid_request", message });
  if (q.get("client_id") !== OAUTH_CLIENT_ID) {
    return bad(`unknown client_id (expected "${OAUTH_CLIENT_ID}")`);
  }
  const challenge = q.get("code_challenge");
  if (!challenge) return bad("code_challenge is required");
  if (q.get("code_challenge_method") !== "S256") {
    return bad('code_challenge_method must be "S256"');
  }
  const redirectUri = q.get("redirect_uri");
  if (!redirectUri || !isLoopbackRedirectUri(redirectUri)) {
    return bad("redirect_uri must be a loopback http URI (e.g. http://127.0.0.1:<port>/callback)");
  }
  // Stub-grade consent: auto-approve for callers holding the CI bearer token, or when
  // DOCSX_OAUTH_AUTO_APPROVE=1. A real interactive consent UI is hosted-deployment
  // scope (owner-gated).
  const token = bearerToken(req);
  const approved =
    (token !== null && isCiToken(token)) || process.env.DOCSX_OAUTH_AUTO_APPROVE === "1";
  if (!approved) {
    return sendJson(res, 403, {
      error: "consent_required",
      message:
        "auto-approval declined — present Authorization: Bearer <DOCSX_TOKEN> or set DOCSX_OAUTH_AUTO_APPROVE=1 (interactive consent is hosted-deployment scope)",
    });
  }
  const code = oauth.issueCode({ challenge, redirectUri });
  const location = new URL(redirectUri);
  location.searchParams.set("code", code);
  const state = q.get("state");
  if (state !== null) location.searchParams.set("state", state);
  res.writeHead(302, { location: location.toString() }).end();
}

export async function handleToken(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: OAuthHttpContext,
): Promise<void> {
  const { oauth } = ctx;
  const raw = (await readBody(req, JSON_BODY_LIMIT_BYTES)).toString("utf8");
  const form = new URLSearchParams(raw);
  const grantType = form.get("grant_type");
  try {
    if (grantType === "authorization_code") {
      const code = form.get("code");
      const verifier = form.get("code_verifier");
      if (!code || !verifier) {
        throw new OAuthError("invalid_request", "code and code_verifier are required");
      }
      const redirectUri = form.get("redirect_uri");
      return sendJson(
        res,
        200,
        oauth.exchangeCode({
          code,
          verifier,
          ...(redirectUri !== null ? { redirectUri } : {}),
        }),
      );
    }
    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token");
      if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
      return sendJson(res, 200, oauth.refresh(refreshToken));
    }
    throw new OAuthError(
      "unsupported_grant_type",
      'grant_type must be "authorization_code" or "refresh_token"',
    );
  } catch (e) {
    if (e instanceof OAuthError) return sendJson(res, 400, { error: e.code, message: e.message });
    throw e;
  }
}
