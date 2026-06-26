// Pure, closure-free HTTP plumbing shared by the backend server and its handler siblings: route
// matching against the ROUTES table, request-body reading with byte limits, JSON parsing, and the
// small validators/predicates the route handlers lean on. Nothing here closes over server state —
// everything is a free function or value so the handler siblings can import it without a cycle.

import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  BLOB_BODY_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  REVISION_ARTIFACTS,
  ROUTES,
  type RevisionArtifact,
} from "./api.js";

export { BLOB_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES };

export interface Matched {
  route: (typeof ROUTES)[number];
  params: Record<string, string>;
}

export function matchRoute(method: string, pathname: string): Matched | "method_mismatch" | null {
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

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new PayloadTooLargeError(limit);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    total += chunk.length;
    if (total > limit) throw new PayloadTooLargeError(limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBody(req, JSON_BODY_LIMIT_BYTES)).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
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
