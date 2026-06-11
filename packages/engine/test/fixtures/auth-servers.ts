// Loopback fixture servers for the auth-strategy suites. Every server binds 127.0.0.1:0 (an
// ephemeral port) and exists for the lifetime of one test file. Credentials here are throwaway
// fixture literals — they authenticate nothing outside these in-process servers.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { generateTotp, verifyTotp } from "../../src/auth/totp.js";

export interface FixtureServer {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

export const FIXTURE_USER = "alice";
export const FIXTURE_PASS = "fixture-pass";
export const FIXTURE_CLIENT_ID = "fixture-client";
export const FIXTURE_CLIENT_SECRET = "fixture-client-secret";
export const FIXTURE_BACKDOOR_SECRET = "fixture-backdoor-secret";
/** Base32 of the ASCII key "12345678901234567890" (the RFC 6238 SHA-1 test key). */
export const FIXTURE_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body>${body}</body></html>`);
}

function parseCredsBody(req: IncomingMessage, body: string): Record<string, string> {
  const ct = req.headers["content-type"] ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(body) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function cookieMap(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

const HOUR = 3_600_000;

/**
 * JSON/form login API:
 *   POST /login          valid creds → 302 → /issue (sets `pre=1`) → /session sets `sid` (+1h
 *                        Expires, HttpOnly, SameSite=Lax) and answers `{ ok: true, user: { name } }`.
 *   POST /login-direct   no redirect: sets `sid` and answers the same JSON directly.
 *   GET  /loop           redirects to itself forever (max-hops tests).
 *   GET  /whoami         echoes the request's cookie names (jar-replay assertions).
 */
export function startJsonLoginServer(): Promise<FixtureServer> {
  return listen((req, res, body) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const sidExpiry = new Date(Date.now() + HOUR).toUTCString();
    const issueSid = () =>
      res.setHeader(
        "set-cookie",
        `sid=fixture-session; Path=/; Expires=${sidExpiry}; HttpOnly; SameSite=Lax`,
      );

    if (req.method === "POST" && (url.pathname === "/login" || url.pathname === "/login-direct")) {
      const creds = parseCredsBody(req, body);
      if (creds.username !== FIXTURE_USER || creds.password !== FIXTURE_PASS) {
        sendJson(res, 401, { ok: false, error: "bad credentials" });
        return;
      }
      if (url.pathname === "/login-direct") {
        issueSid();
        sendJson(res, 200, { ok: true, user: { name: FIXTURE_USER } });
        return;
      }
      res.writeHead(302, { location: "/issue", "set-cookie": "pre=1; Path=/" });
      res.end();
      return;
    }
    if (url.pathname === "/issue") {
      if (cookieMap(req).pre !== "1") {
        sendJson(res, 400, { ok: false, error: "redirect hop lost the pre cookie" });
        return;
      }
      res.writeHead(302, { location: "/session" });
      res.end();
      return;
    }
    if (url.pathname === "/session") {
      issueSid();
      sendJson(res, 200, { ok: true, user: { name: FIXTURE_USER } });
      return;
    }
    if (url.pathname === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
      return;
    }
    if (url.pathname === "/whoami") {
      sendJson(res, 200, { cookies: Object.keys(cookieMap(req)) });
      return;
    }
    sendJson(res, 404, { ok: false });
  });
}

/**
 * HTML form login (for ui-form / email-otp):
 *   GET  /login   form (#user, #pass, #submit) under a click-blocking overlay dismissed by #dismiss.
 *   POST /login   valid creds → plain mode: sets `session` and 303 → /app;
 *                 TOTP mode: sets `pre_otp` and 303 → /otp;
 *                 OTP-mail mode: "mails" a 6-digit code (exposed via onOtpIssued) and 303 → /otp.
 *   GET  /otp     form (#otp, #otp-submit).
 *   POST /otp     valid code (RFC-6238 ±1 step in TOTP mode, the issued code in mail mode)
 *                 → sets `session` and 303 → /app.
 *   GET  /app     `session` cookie → <h1 id="welcome">; otherwise 403.
 */
export function startFormLoginServer(
  opts: { totpSecret?: string; onOtpIssued?: (code: string) => void } = {},
): Promise<FixtureServer> {
  let mailedCode: string | undefined;
  return listen((req, res, body) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const sessionExpiry = new Date(Date.now() + HOUR).toUTCString();
    const issueSession = () =>
      res.setHeader(
        "set-cookie",
        `session=fixture-form-session; Path=/; Expires=${sessionExpiry}; HttpOnly; SameSite=Lax`,
      );

    if (req.method === "GET" && url.pathname === "/login") {
      sendHtml(
        res,
        200,
        `<div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10">
           <button id="dismiss" onclick="document.getElementById('overlay').remove()">Accept cookies</button>
         </div>
         <form method="post" action="/login">
           <input id="user" name="user"><input id="pass" name="pass" type="password">
           <button id="submit" type="submit">Sign in</button>
         </form>`,
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/login") {
      const form = parseCredsBody(req, body);
      if (form.user !== FIXTURE_USER || form.pass !== FIXTURE_PASS) {
        sendHtml(res, 401, `<p id="error">bad credentials</p>`);
        return;
      }
      if (opts.totpSecret || opts.onOtpIssued) {
        if (opts.onOtpIssued) {
          mailedCode = String(Math.floor(100000 + Math.random() * 900000));
          opts.onOtpIssued(mailedCode);
        }
        res.writeHead(303, { location: "/otp", "set-cookie": "pre_otp=1; Path=/" });
        res.end();
        return;
      }
      issueSession();
      res.writeHead(303, { location: "/app" });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/otp") {
      sendHtml(
        res,
        200,
        `<form method="post" action="/otp">
           <input id="otp" name="otp"><button id="otp-submit" type="submit">Verify</button>
         </form>`,
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/otp") {
      const form = parseCredsBody(req, body);
      const code = form.otp ?? "";
      const valid = opts.totpSecret
        ? verifyTotp(code, opts.totpSecret, { window: 1 })
        : mailedCode !== undefined && code === mailedCode;
      if (cookieMap(req).pre_otp !== "1" || !valid) {
        sendHtml(res, 401, `<p id="error">bad code</p>`);
        return;
      }
      issueSession();
      res.writeHead(303, { location: "/app" });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/app") {
      if (cookieMap(req).session !== "fixture-form-session") {
        sendHtml(res, 403, `<p id="error">not signed in</p>`);
        return;
      }
      sendHtml(res, 200, `<h1 id="welcome">Welcome, ${FIXTURE_USER}</h1>`);
      return;
    }
    sendHtml(res, 404, "<p>not found</p>");
  });
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** Unsigned JWT-shaped token whose payload carries `exp` (epoch seconds). Decode-only fixtures. */
export function makeFixtureJwt(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}.fixture-sig`;
}

/**
 * OAuth2 client-credentials token endpoint:
 *   POST /token (form-encoded grant_type/client_id/client_secret) → `{ access_token, expires_in?, token_type }`.
 *   `expiresInBody: false` omits `expires_in` so callers must read the JWT `exp` claim instead.
 */
export function startTokenServer(opts: { expiresInBody?: boolean } = {}): Promise<FixtureServer> {
  const includeExpiresIn = opts.expiresInBody !== false;
  return listen((req, res, body) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST" || url.pathname !== "/token") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const form = Object.fromEntries(new URLSearchParams(body));
    if (
      form.grant_type !== "client_credentials" ||
      form.client_id !== FIXTURE_CLIENT_ID ||
      form.client_secret !== FIXTURE_CLIENT_SECRET
    ) {
      sendJson(res, 401, { error: "invalid_client" });
      return;
    }
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    sendJson(res, 200, {
      access_token: makeFixtureJwt({ sub: "fixture", exp: expSec }),
      token_type: "Bearer",
      ...(includeExpiresIn ? { expires_in: 3600 } : {}),
    });
  });
}

/**
 * Mailpit-style inbox: GET /inbox → `{ messages: [{ to, received_at, body }] }`.
 * A message "arrives" `deliverAfterMs` after `deliver()` is called (or after start when
 * `deliverAfterMs` elapses and `deliver` was already invoked).
 */
export function startInboxServer(): Promise<
  FixtureServer & { deliver(msg: { to: string; body: string; afterMs?: number }): void }
> {
  const messages: Array<{ to: string; received_at: string; body: string }> = [];
  return listen((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/inbox") {
      sendJson(res, 200, { messages });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }).then((server) =>
    Object.assign(server, {
      deliver(msg: { to: string; body: string; afterMs?: number }) {
        const push = () =>
          messages.push({ to: msg.to, received_at: new Date().toISOString(), body: msg.body });
        if (msg.afterMs) setTimeout(push, msg.afterMs);
        else push();
      },
    }),
  );
}

/**
 * Test-only backdoor endpoint: POST /backdoor `{ secret, user_id }` — right secret → sets
 * `backdoor_session=uid-<user_id>` (Max-Age 1h) + 200; wrong secret → 403; `/backdoor-no-cookie`
 * answers 200 without setting anything.
 */
export function startBackdoorServer(): Promise<FixtureServer> {
  return listen((req, res, body) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let parsed: { secret?: string; user_id?: string | number };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      sendJson(res, 400, { error: "bad json" });
      return;
    }
    if (parsed.secret !== FIXTURE_BACKDOOR_SECRET) {
      sendJson(res, 403, { error: "bad secret" });
      return;
    }
    if (url.pathname === "/backdoor-no-cookie") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/backdoor") {
      res.setHeader(
        "set-cookie",
        `backdoor_session=uid-${parsed.user_id ?? "default"}; Path=/; Max-Age=3600; HttpOnly`,
      );
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
}

/** Current RFC-6238 code for the fixture TOTP secret (what a real authenticator app would show). */
export function currentFixtureTotp(): string {
  return generateTotp(FIXTURE_TOTP_SECRET);
}
