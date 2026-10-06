// Network guards for the opt-in Streamable HTTP transport: the bind policy (loopback unless the
// operator says otherwise) and the Host / Origin allowlists that stop DNS rebinding.

import { isIPv4 } from "node:net";

export const DEFAULT_HOST = "127.0.0.1";
const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "::1"];

/** Raised for a bind or allowlist option the server refuses to start with. */
export class BindPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindPolicyError";
  }
}

/**
 * Reduce a Host header, an Origin hostname or an allowlist entry to a lowercase hostname with no
 * port and no IPv6 brackets. Returns undefined for an empty or malformed value.
 */
export function normalizeHostname(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end > 1 ? v.slice(1, end) : undefined;
  }
  const first = v.indexOf(":");
  // More than one colon is a bare IPv6 literal; keep it whole.
  if (first !== v.lastIndexOf(":")) return v;
  return first < 0 ? v : v.slice(0, first) || undefined;
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

/** A missing Host header is refused; HTTP/1.1 requires one. */
export function hostHeaderAllowed(
  header: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  const name = header === undefined ? undefined : normalizeHostname(header);
  return name !== undefined && allowed.has(name);
}

/** No Origin header means a non-browser client and passes. A present Origin must name an allowed host. */
export function originAllowed(origin: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (origin === undefined) return true;
  let hostname: string | undefined;
  try {
    hostname = normalizeHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
  return hostname !== undefined && allowed.has(hostname);
}
