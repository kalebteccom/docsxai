// Validation of a project's `app_url`: the base URL a webhook run points the engine at. The
// engine screenshots whatever it names, so the backend refuses targets that expose a cloud
// instance's credentials (link-local and metadata addresses) always, and loopback and
// private-network targets when the deployment asks for it. The host is checked as written, after
// the WHATWG URL parser has normalised numeric IPv4 forms and IPv6; a DNS name is not resolved.

/** Longest accepted `app_url`. */
export const MAX_APP_URL_LENGTH = 2048;

/** Env var that makes the backend also refuse loopback, RFC 1918, CGNAT and ULA `app_url` hosts. */
export const DENY_PRIVATE_APP_URL_ENV = "DOCSX_BACKEND_DENY_PRIVATE_APP_URL";

export interface AppUrlOptions {
  /** Also refuse loopback, private-network and unique-local hosts. Default false. */
  denyPrivate?: boolean;
}

/** True when `env` asks for loopback and private-network `app_url` hosts to be refused. */
export function denyPrivateAppUrl(env: NodeJS.ProcessEnv): boolean {
  return env[DENY_PRIVATE_APP_URL_ENV] === "1";
}

const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "instance-data"]);

type Ipv4 = [number, number, number, number];

function parseIpv4(host: string): Ipv4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number) as Ipv4;
  return parts.every((n) => n <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 literal (brackets optional), or null when it is not one. */
function parseIpv6(host: string): number[] | null {
  const bare = host.replace(/^\[|\]$/g, "");
  if (!bare.includes(":")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (const [i, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        const v4 = i === pieces.length - 1 ? parseIpv4(piece) : null;
        if (!v4) return null;
        groups.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        groups.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };
  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill >= 1 ? [...head, ...new Array<number>(fill).fill(0), ...tail] : null;
}

/** Why an IPv4 address is refused, or null. */
function ipv4Problem(ip: Ipv4, denyPrivate: boolean): string | null {
  const [a, b, c, d] = ip;
  if ((a === 169 && b === 254) || (a === 100 && b === 100 && c === 100 && d === 200)) {
    return "link-local or cloud-metadata";
  }
  if (!denyPrivate) return null;
  const isPrivate =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  return isPrivate ? "loopback or private-network" : null;
}

/** Why an IPv6 address is refused, or null. An embedded IPv4 address is checked as IPv4. */
function ipv6Problem(g: number[], denyPrivate: boolean): string | null {
  const at = (i: number): number => g[i] ?? 0;
  const g0 = at(0);
  const g5 = at(5);
  const g6 = at(6);
  const g7 = at(7);
  const v4: Ipv4 = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  const zeros = (from: number, to: number): boolean => g.slice(from, to).every((n) => n === 0);
  const mapped = zeros(0, 5) && g5 === 0xffff;
  const compatible = zeros(0, 6) && g6 !== 0;
  const nat64 = g0 === 0x64 && at(1) === 0xff9b && zeros(2, 6);
  if (mapped || compatible || nat64) {
    const embedded = ipv4Problem(v4, denyPrivate);
    if (embedded) return embedded;
  }
  if ((g0 & 0xffc0) === 0xfe80) return "link-local or cloud-metadata";
  if (g0 === 0xfd00 && at(1) === 0x0ec2 && zeros(2, 7) && g7 === 0x254) {
    return "link-local or cloud-metadata";
  }
  if (!denyPrivate) return null;
  const unspecified = zeros(0, 8);
  const loopback = zeros(0, 7) && g7 === 1;
  const uniqueLocal = (g0 & 0xfe00) === 0xfc00;
  return unspecified || loopback || uniqueLocal ? "loopback or private-network" : null;
}

/** Why `hostname` (as `URL.hostname` prints it) is refused, or null. */
function hostProblem(hostname: string, denyPrivate: boolean): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  const v4 = parseIpv4(host);
  if (v4) return ipv4Problem(v4, denyPrivate);
  const v6 = parseIpv6(host);
  if (v6) return ipv6Problem(v6, denyPrivate);
  if (METADATA_HOSTNAMES.has(host)) return "link-local or cloud-metadata";
  if (denyPrivate && (host === "localhost" || host.endsWith(".localhost"))) {
    return "loopback or private-network";
  }
  return null;
}

/**
 * Why `value` cannot be a project's `app_url`, or null when it can: a string of at most
 * {@link MAX_APP_URL_LENGTH} characters that parses as an absolute `http:` or `https:` URL with a
 * host and no embedded credentials, whose host is not a link-local or cloud-metadata address
 * (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `100.100.100.200`, `metadata.google.internal`,
 * `instance-data`, in any spelling the URL parser normalises) and, under `denyPrivate`, not a
 * loopback, RFC 1918, CGNAT or unique-local one either.
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
