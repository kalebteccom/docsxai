// Pure, closure-free HTTP plumbing shared by the backend server and its handler siblings: route
// matching against the ROUTES table, request-body reading with byte limits, JSON parsing, and the
// small validators/predicates the route handlers lean on. Nothing here closes over server state,
// everything is a free function or value so the handler siblings can import it without a cycle.

import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  BLOB_BODY_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  REVISION_ARTIFACTS,
  ROUTES,
  type RevisionArtifact,
} from "./api.js";
import { type RunInput } from "./store.js";

export { BLOB_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES };

export interface Matched {
  route: (typeof ROUTES)[number];
  params: Record<string, string>;
}

/** The liveness probe also answers HEAD, which load balancer health checks commonly send. */
const HEAD_AS_GET_PATH = "/v1/health";

export function matchRoute(method: string, pathname: string): Matched | "method_mismatch" | null {
  if (method === "HEAD" && pathname.replace(/\/+$/, "") === HEAD_AS_GET_PATH) {
    return matchRoute("GET", pathname);
  }
  const segs = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  let methodMismatch = false;
  for (const route of ROUTES) {
    const rsegs = route.path.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      const r = rsegs[i]!;
      const s = segs[i]!;
      if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(s);
      else if (r !== s) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (route.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route, params };
  }
  return methodMismatch ? "method_mismatch" : null;
}

/** Validate a run-history body. Returns the record to append, or the problem as a message. */
export function parseRunInput(v: unknown): RunInput | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "body must be a JSON object";
  const b = v as Record<string, unknown>;
  if (typeof b.rev !== "string" || b.rev.length === 0) return "rev must be a revision id or 'head'";
  if (typeof b.ok !== "boolean") return "ok must be a boolean";
  const duration = b.duration_ms ?? 0;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
    return "duration_ms must be a non-negative number";
  }
  const summary = b.summary ?? "";
  if (typeof summary !== "string") return "summary must be a string";
  return { rev: b.rev, ok: b.ok, duration_ms: duration, summary };
}

/** Methods the route table serves on `pathname`, sorted (the `Allow` header of a 405). */
export function allowedMethods(pathname: string): string[] {
  const allowed: string[] = [];
  for (const method of new Set(ROUTES.map((r) => r.method))) {
    const m = matchRoute(method, pathname);
    if (m !== null && m !== "method_mismatch") allowed.push(method);
  }
  return allowed.sort();
}

export function isArtifact(s: string): s is RevisionArtifact {
  return (REVISION_ARTIFACTS as readonly string[]).includes(s);
}

/** First value of a possibly-multi-valued header. */
export function asSingle(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const SAFE_ROLE = /^[A-Za-z0-9_.-]{1,128}$/;

export class PayloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds the ${limit}-byte limit`);
    this.name = "PayloadTooLargeError";
  }
}

/** A request the client got wrong (unparsable JSON, a missing field); answered with 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/**
 * Read a request body, rejecting with {@link PayloadTooLargeError} past `limit`. Reads through
 * `data` events: breaking out of `for await` destroys the request and its socket, which would
 * turn a 413 into a connection reset for a chunked upload. After the rejection the stream keeps
 * draining and the surplus is dropped.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new PayloadTooLargeError(limit));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      total += chunk.length;
      if (total > limit) {
        over = true;
        chunks.length = 0;
        reject(new PayloadTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("close", () => reject(new Error("request closed before the body was read")));
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(req, JSON_BODY_LIMIT_BYTES)).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new BadRequestError(`invalid JSON body: ${(e as Error).message}`);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text + "\n");
}

/** Extract the bearer credential from the Authorization header, or null when absent. */
export function bearerToken(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return m ? m[1]! : null;
}
