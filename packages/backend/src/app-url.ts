// Validation of a project's `app_url`: the base URL a webhook run points the engine at. The
// engine screenshots whatever it names, so the backend refuses targets that expose a cloud
// instance's credentials (link-local and metadata addresses) always, and loopback and
// private-network targets when the deployment asks for it. The host is checked as written, after
// the WHATWG URL parser has normalised numeric IPv4 forms and IPv6; a DNS name is not resolved
// here (the engine's request guard resolves names, see `packages/engine/src/egress-guard.ts`).

import { hostProblem } from "./address-class.js";

/** Longest accepted `app_url`. */
export const MAX_APP_URL_LENGTH = 2048;

/** Env var that makes the backend also refuse loopback, RFC 1918, CGNAT and ULA `app_url` hosts. */
export const DENY_PRIVATE_APP_URL_ENV = "DOCSX_BACKEND_DENY_PRIVATE_APP_URL";

export interface AppUrlOptions {
  /** Also refuse loopback, private-network and unique-local hosts. Default false. */
  denyPrivate?: boolean;
}

/** True for `1`, `true` and `yes` in any case: the spellings every `DOCSX_*` on/off switch takes. */
export function isEnvFlagOn(value: string | undefined): boolean {
  return value !== undefined && /^(?:1|true|yes)$/i.test(value.trim());
}

/** True for `0`, `false` and `no` in any case: the spellings that say off on purpose. */
export function isEnvFlagOff(value: string | undefined): boolean {
  return value !== undefined && /^(?:0|false|no)$/i.test(value.trim());
}

/** True when `env` asks for loopback and private-network `app_url` hosts to be refused. */
export function denyPrivateAppUrl(env: NodeJS.ProcessEnv): boolean {
  return isEnvFlagOn(env[DENY_PRIVATE_APP_URL_ENV]);
}

/**
 * Why `value` cannot be a project's `app_url`, or null when it can: a string of at most
 * {@link MAX_APP_URL_LENGTH} characters that parses as an absolute `http:` or `https:` URL with a
 * host and no embedded credentials, whose host is not a link-local or cloud-metadata address
 * (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `100.100.100.200`, `168.63.129.16`,
 * `metadata.google.internal`, `instance-data`, in any spelling the URL parser normalises, and an
 * IPv6 address that embeds one through IPv4-mapping, NAT64, 6to4 or Teredo) and, under
 * `denyPrivate`, not a loopback, RFC 1918, CGNAT, unique-local or site-local one either.
 */
export function appUrlProblem(value: unknown, options: AppUrlOptions = {}): string | null {
  if (typeof value !== "string" || value.length === 0) return "app_url must be a non-empty string";
  if (value.length > MAX_APP_URL_LENGTH) {
    return `app_url must be at most ${MAX_APP_URL_LENGTH} characters`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "app_url must be an absolute http(s) URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "app_url must be an absolute http(s) URL";
  }
  if (url.username || url.password) return "app_url must not contain credentials";
  const refused = hostProblem(url.hostname, options.denyPrivate === true);
  return refused ? `app_url must not point at a ${refused} address` : null;
}
