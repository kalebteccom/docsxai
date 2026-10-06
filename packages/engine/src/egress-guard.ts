// Opt-in request guard for the browser a run drives. With `DOCSX_EGRESS_GUARD=1` (or an explicit
// `egressGuard` option on `launchPlaywrightSession`) every request the page makes is checked
// before it leaves: documents, subresources, fetches and each redirect hop (Chromium reports a
// redirect as a new request). A request whose host is, or resolves to, a link-local or
// cloud-metadata address is aborted; with `DOCSX_EGRESS_DENY_PRIVATE=1` loopback, RFC 1918, CGNAT
// and unique-local addresses are aborted too. A lookup that fails or returns nothing aborts the
// request.
//
// Not covered: the name is resolved here and again by the browser, so a DNS answer that changes
// between the two (DNS rebinding) gets through; WebSockets are not routed. Put an egress firewall
// under a hosted deployment. This module has no Playwright import: the driver hands it a context.

import { lookup as dnsLookup } from "node:dns/promises";
import { hostProblem, parseIpv4, parseIpv6 } from "./address-class.js";

export const EGRESS_GUARD_ENV = "DOCSX_EGRESS_GUARD";
export const EGRESS_DENY_PRIVATE_ENV = "DOCSX_EGRESS_DENY_PRIVATE";

/** Resolves a hostname to every address it has. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export interface EgressGuardOptions {
  /** Also refuse loopback, private-network and unique-local addresses. Default false. */
  denyPrivate?: boolean;
  /** Hostname resolver; tests inject one. Default: `dns.lookup` returning all addresses. */
  lookup?: HostLookup;
  /** Told about each refused request, with a URL that carries no query string. */
  onBlock?: (url: string, reason: string) => void;
}

/** True for `1`, `true` and `yes` in any case. */
export function envFlagOn(value: string | undefined): boolean {
  return value !== undefined && /^(?:1|true|yes)$/i.test(value.trim());
}

/** True for `0`, `false` and `no` in any case, the spellings that say off on purpose. */
export function envFlagOff(value: string | undefined): boolean {
  return value !== undefined && /^(?:0|false|no)$/i.test(value.trim());
}

/** The guard `env` asks for, or undefined when `DOCSX_EGRESS_GUARD` is not on. */
export function egressGuardFromEnv(env: NodeJS.ProcessEnv): EgressGuardOptions | undefined {
  if (!envFlagOn(env[EGRESS_GUARD_ENV])) return undefined;
  return { denyPrivate: envFlagOn(env[EGRESS_DENY_PRIVATE_ENV]) };
}

/** An explicit option wins; otherwise the process environment decides. */
export function resolveEgressGuard(
  explicit: EgressGuardOptions | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EgressGuardOptions | undefined {
  return explicit ?? egressGuardFromEnv(env);
}

const defaultLookup: HostLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** Schemes that never leave the browser. */
const INERT_SCHEMES = new Set(["data:", "blob:", "about:"]);
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/** Why a request to `rawUrl` must not go out, or null when it may. */
export async function requestProblem(
  rawUrl: string,
  opts: EgressGuardOptions = {},
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "the URL does not parse";
  }
  if (INERT_SCHEMES.has(url.protocol)) return null;
  if (!NETWORK_SCHEMES.has(url.protocol)) return `the ${url.protocol} scheme is not allowed`;
  const denyPrivate = opts.denyPrivate === true;
  const host = url.hostname.replace(/\.+$/, "");
  const direct = hostProblem(host, denyPrivate);
  if (direct) return `${host} is a ${direct} address`;
  if (parseIpv4(host) || parseIpv6(host)) return null;
  let addresses: string[];
  try {
    addresses = await (opts.lookup ?? defaultLookup)(host);
  } catch (e) {
    return `${host} did not resolve (${(e as Error).message}), refused`;
  }
  if (addresses.length === 0) return `${host} resolved to no address, refused`;
  for (const address of addresses) {
    const problem = hostProblem(address, denyPrivate);
    if (problem) return `${host} resolves to ${address}, a ${problem} address`;
  }
  return null;
}

/** The part of a Playwright `Route` the guard uses. */
export interface GuardRoute {
  request(): { url(): string };
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

/** The part of a Playwright `BrowserContext` the guard uses. */
export interface GuardableContext {
  route(url: RegExp, handler: (route: GuardRoute) => Promise<void>): Promise<void>;
}

/** Context options a guarded context needs: a service worker's own fetches are not routed. */
export function egressContextOptions(guard: EgressGuardOptions | undefined): {
  serviceWorkers?: "block";
} {
  return guard ? { serviceWorkers: "block" } : {};
}

const withoutQuery = (rawUrl: string): string => rawUrl.replace(/[?#].*$/s, "");

/** Route every request of `context` through {@link requestProblem}; a no-op without a guard. */
export async function installEgressGuard(
  context: GuardableContext,
  guard: EgressGuardOptions | undefined,
): Promise<void> {
  if (!guard) return;
  await context.route(/.*/, async (route) => {
    const url = route.request().url();
    const problem = await requestProblem(url, guard).catch(
      (e: unknown) => `the check failed (${(e as Error).message}), refused`,
    );
    if (problem === null) return route.continue();
    const shown = withoutQuery(url);
    if (guard.onBlock) guard.onBlock(shown, problem);
    else process.stderr.write(`egress-guard: blocked ${shown}: ${problem}\n`);
    return route.abort("blockedbyclient");
  });
}
