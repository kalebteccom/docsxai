// OAuth 2.1 + PKCE login flow (`docsxai login --oauth`): drives the authorization-code handshake
// against the backend's minimal authorization server. Re-exported from `./backend-client.js`.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  BackendClientError,
  type BackendTokenFile,
  type OAuthLoginOptions,
} from "./backend-client-contracts.js";

/**
 * Drive the authorization-code + PKCE handshake against the backend's minimal authorization
 * server: start a loopback listener for the redirect, hand the authorize URL to the caller,
 * await the code, exchange it (S256 verifier) for tokens.
 */
export async function oauthLogin(opts: OAuthLoginOptions): Promise<BackendTokenFile> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.backendUrl.replace(/\/+$/, "");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const gotCode = u.searchParams.get("code");
    if (u.searchParams.get("state") !== state || !gotCode) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("docsxai login: state mismatch or missing code\n");
      rejectCode(new BackendClientError("OAuth redirect carried a bad state or no code"));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("docsxai login complete — you can close this tab.\n");
    resolveCode(gotCode);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new BackendClientError("failed to bind the OAuth callback listener"));
    });
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizeUrl = new URL(`${base}/v1/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", "docsxai-cli");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  opts.onAuthorizeUrl(authorizeUrl.toString());

  const timer = setTimeout(() => {
    rejectCode(new BackendClientError("OAuth login timed out waiting for the browser redirect"));
  }, opts.timeoutMs ?? 300_000);
  timer.unref();

  let code: string;
  try {
    code = await codePromise;
  } finally {
    clearTimeout(timer);
    server.close();
  }

  const res = await doFetch(`${base}/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendClientError(
      `token exchange → ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
}
