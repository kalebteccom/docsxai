// Network guards for the opt-in Streamable HTTP transport: the bind policy (loopback unless the
// operator says otherwise) and the Host / Origin allowlists that stop DNS rebinding.

import { isIPv4, isIPv6 } from "node:net";

export const DEFAULT_HOST = "127.0.0.1";
const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "::1"];

/** Raised for a bind or allowlist option the server refuses to start with. */
export class BindPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindPolicyError";
  }
}

export interface HostPort {
  hostname: string;
  port?: number;
}

// host[:port] and nothing else: a DNS name or IPv4 literal, or an IPv6 literal in brackets.
const HOST_PORT = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?))(?::(\d{1,5}))?$/i;

/**
 * Strictly parse a Host header value or an Origin authority. Anything beyond `host[:port]`
 * (userinfo, a path, spaces, a second colon outside brackets) returns undefined. The hostname is
 * lowercased and carries no IPv6 brackets.
 */
export function parseHostPort(raw: string): HostPort | undefined {
  const m = HOST_PORT.exec(raw);
  if (!m) return undefined;
  const v6 = m[1];
  if (v6 !== undefined && !isIPv6(v6)) return undefined;
  const port = m[3] === undefined ? undefined : Number(m[3]);
  if (port !== undefined && port > 65535) return undefined;
  return { hostname: (v6 ?? m[2]!).toLowerCase(), ...(port !== undefined ? { port } : {}) };
}

/**
 * Reduce a configured host (`--host`, `--allowed-host`) to a lowercase hostname with no port and
 * no IPv6 brackets. A bare IPv6 literal is accepted here, since that is how `--host ::1` is
 * written. Returns undefined for an empty or malformed value.
 */
export function normalizeHostname(raw: string): string | undefined {
  const v = raw.trim();
  if (isIPv6(v)) return v.toLowerCase();
  return parseHostPort(v)?.hostname;
}

export function isLoopbackHost(host: string): boolean {
  const name = normalizeHostname(host);
  if (!name) return false;
  return LOOPBACK_NAMES.includes(name) || (isIPv4(name) && name.startsWith("127."));
}

const WILDCARD_BINDS = ["0.0.0.0", "::", "*"];

/** Refuse a non-loopback bind unless the operator passed `--allow-remote`. */
export function assertBindPolicy(host: string, allowRemote: boolean): void {
  if (isLoopbackHost(host) || allowRemote) return;
  throw new BindPolicyError(
    "refusing to bind a non-loopback host without --allow-remote (terminate TLS in front of the server when you pass it)",
  );
}

/**
 * The hostnames a request may address: loopback names, the bound host when it is a concrete
 * address, and every `--allowed-host` entry. Entries are exact hostnames; no wildcards.
 */
export function buildAllowedHosts(bindHost: string, extra: ReadonlyArray<string>): Set<string> {
  const allowed = new Set<string>(LOOPBACK_NAMES);
  const bound = normalizeHostname(bindHost);
  if (bound && !WILDCARD_BINDS.includes(bound)) allowed.add(bound);
  for (const entry of extra) {
    const name = /[*/\s@]/.test(entry) ? undefined : normalizeHostname(entry);
    if (!name) throw new BindPolicyError("--allowed-host takes exact hostnames, with no wildcards");
    allowed.add(name);
  }
  return allowed;
}

/** A missing or malformed Host header is refused; HTTP/1.1 requires one. */
export function hostHeaderAllowed(
  header: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  const parsed = header === undefined ? undefined : parseHostPort(header);
  return parsed !== undefined && allowed.has(parsed.hostname);
}

interface ParsedOrigin {
  hostname: string;
  port: number;
  /** `scheme://host:port` with the port always explicit, the form `--allowed-origin` is compared in. */
  canonical: string;
}

const ORIGIN = /^(https?):\/\/([^/?#@\s]+)$/i;

function parseOrigin(raw: string): ParsedOrigin | undefined {
  const m = ORIGIN.exec(raw);
  const hp = m ? parseHostPort(m[2]!) : undefined;
  if (!m || !hp) return undefined;
  const scheme = m[1]!.toLowerCase();
  const port = hp.port ?? (scheme === "https" ? 443 : 80);
  const host = hp.hostname.includes(":") ? `[${hp.hostname}]` : hp.hostname;
  return { hostname: hp.hostname, port, canonical: `${scheme}://${host}:${port}` };
}

/** Exact `scheme://host[:port]` origins, no wildcards, for `--allowed-origin`. */
export function buildAllowedOrigins(entries: ReadonlyArray<string>): Set<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    const parsed = parseOrigin(entry);
    if (!parsed) {
      throw new BindPolicyError("--allowed-origin takes exact scheme://host[:port] origins");
    }
    out.add(parsed.canonical);
  }
  return out;
}

/**
 * No Origin header means a non-browser client and passes. A present Origin passes when it is an
 * `--allowed-origin` entry, or when its host is an allowed host and its port is the port the
 * server is bound to. An opaque (`null`) or malformed Origin never passes.
 */
export function originAllowed(
  origin: string | undefined,
  allowedHosts: ReadonlySet<string>,
  boundPort: number,
  allowedOrigins: ReadonlySet<string> = new Set(),
): boolean {
  if (origin === undefined) return true;
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  if (allowedOrigins.has(parsed.canonical)) return true;
  return allowedHosts.has(parsed.hostname) && parsed.port === boundPort;
}
