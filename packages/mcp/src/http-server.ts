// Opt-in Streamable HTTP transport for docsxai-mcp (`docsxai-mcp serve --http`). Every request
// passes the same gates in the same order: Host, Origin, bearer token, path, method, body size,
// then the session table. Error responses are fixed one-line JSON codes with no detail in them.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { assertTokenStrength, createBearerVerifier } from "./http-auth.js";
import {
  assertBindPolicy,
  buildAllowedHosts,
  DEFAULT_HOST,
  hostHeaderAllowed,
  originAllowed,
} from "./http-guard.js";
import { SessionRegistry } from "./http-sessions.js";
import { createDocsxaiMcpServer } from "./server.js";

export const DEFAULT_PORT = 8765;
export const MCP_PATH = "/mcp";
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_SESSIONS = 16;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface HttpServerOptions {
  /** Bearer token. Validated here as well as by the loader, so a library caller cannot skip it. */
  token: string;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
  /** Required to bind anything but loopback. TLS must terminate in front of the server. */
  allowRemote?: boolean;
  /** Extra hostnames accepted in the Host and Origin headers. Exact names, no wildcards. */
  allowedHosts?: string[];
  maxBodyBytes?: number;
  maxSessions?: number;
  idleTimeoutMs?: number;
  /** Default workspace for tool calls that omit `workspace`, as on the stdio entry point. */
  defaultWorkspace?: string;
  /** Operator log sink. Never receives headers, bodies or the token. */
  log?: (line: string) => void;
}

export interface RunningHttpServer {
  host: string;
  port: number;
  /** Endpoint URL clients connect to. */
  url: string;
  sessionCount(): number;
  close(): Promise<void>;
}

class BodyTooLargeError extends Error {}
class BadJsonError extends Error {}

const STATUS_CODES = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  413: "payload_too_large",
  429: "too_many_sessions",
  500: "internal_error",
} as const;

function reject(
  res: ServerResponse,
  status: keyof typeof STATUS_CODES,
  extra: Record<string, string> = {},
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(JSON.stringify({ error: STATUS_CODES[status] }));
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Read a JSON body of at most `maxBytes`. Listens for events instead of iterating the stream, so
 * going over the limit leaves the socket open long enough to send the 413.
 */
function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(headerValue(req, "content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    return Promise.reject(new BodyTooLargeError());
  return new Promise((resolve, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      rejectBody(e);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) return fail(new BodyTooLargeError());
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(new BadJsonError());
      }
    });
    req.on("error", fail);
    req.on("close", () => fail(new Error("request closed")));
  });
}

/** Start the HTTP server. Rejects, without binding, when the token or the bind policy is refused. */
export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const host = opts.host ?? DEFAULT_HOST;
  assertTokenStrength(opts.token);
  assertBindPolicy(host, opts.allowRemote ?? false);
  const allowedHosts = buildAllowedHosts(host, opts.allowedHosts ?? []);
  const verifyBearer = createBearerVerifier(opts.token);
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const log = opts.log ?? (() => undefined);
  const sessions = new SessionRegistry({
    maxSessions: opts.maxSessions ?? DEFAULT_MAX_SESSIONS,
    idleTimeoutMs: opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    createServer: () =>
      createDocsxaiMcpServer(
        opts.defaultWorkspace ? { defaultWorkspace: opts.defaultWorkspace } : {},
      ),
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostHeaderAllowed(req.headers.host, allowedHosts)) return reject(res, 403);
    if (!originAllowed(headerValue(req, "origin"), allowedHosts)) return reject(res, 403);
    if (!verifyBearer(headerValue(req, "authorization"))) {
      return reject(res, 401, { "WWW-Authenticate": "Bearer" });
    }
    if ((req.url ?? "").split("?")[0] !== MCP_PATH) return reject(res, 404);
    const method = req.method ?? "";
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      return reject(res, 405, { Allow: "GET, POST, DELETE" });
    }

    let body: unknown;
    if (method === "POST") {
      try {
        body = await readJsonBody(req, maxBodyBytes);
      } catch (e) {
        if (e instanceof BodyTooLargeError) {
          // Discard the rest of the body, then cut the socket; an abrupt close before the client
          // reads the 413 can reset the connection and lose it.
          req.resume();
          res.once("finish", () => setTimeout(() => req.socket.destroy(), 1000).unref());
          return reject(res, 413, { Connection: "close" });
        }
        return reject(res, 400);
      }
    }

    const sessionId = headerValue(req, "mcp-session-id");
    if (sessionId) {
      if (!(await sessions.handleExisting(sessionId, req, res, body))) reject(res, 404);
      return;
    }
    if (method === "POST" && isInitializeRequest(body)) {
      if (!(await sessions.handleInitialize(req, res, body))) {
        reject(res, 429, { "Retry-After": "5" });
      }
      return;
    }
    reject(res, 400);
  }

  const http: Server = createHttpServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      log(`request failed: ${e instanceof Error ? e.name : "unknown error"}`);
      reject(res, 500);
    });
  });

  await new Promise<void>((resolve, rejectListen) => {
    http.once("error", rejectListen);
    http.listen(opts.port ?? DEFAULT_PORT, host, () => {
      http.off("error", rejectListen);
      resolve();
    });
  });

  const port = (http.address() as AddressInfo).port;
  const shownHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return {
    host,
    port,
    url: `http://${shownHost}:${port}${MCP_PATH}`,
    sessionCount: () => sessions.size,
    async close() {
      await sessions.closeAll();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
