// Address classification shared by two packages that cannot import each other: the backend's
// `app_url` filter and the engine's request guard each carry a byte-identical copy of this file
// (`packages/backend/src/address-class.ts`, `packages/engine/src/address-class.ts`), and a test in
// `packages/docsxai/test` fails when the two differ. Edit both together.
//
// jscpd:ignore-start

/** Why an address is refused: link-local ranges and cloud instance-metadata endpoints. */
export const LINK_LOCAL_OR_METADATA = "link-local or cloud-metadata";

/** Why an address is refused under `denyPrivate`: loopback, RFC 1918, CGNAT, ULA and the like. */
export const LOOPBACK_OR_PRIVATE = "loopback or private-network";

export type Ipv4 = [number, number, number, number];

const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "instance-data"]);
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

export function parseIpv4(host: string): Ipv4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number) as Ipv4;
  return parts.every((n) => n <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 literal (brackets and a zone id optional), or null. */
export function parseIpv6(host: string): number[] | null {
  const bare = host.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
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
  const metadata =
    (a === 169 && b === 254) ||
    (a === 100 && b === 100 && c === 100 && d === 200) ||
    (a === 168 && b === 63 && c === 129 && d === 16);
  if (metadata) return LINK_LOCAL_OR_METADATA;
  if (!denyPrivate) return null;
  const isPrivate =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
  return isPrivate ? LOOPBACK_OR_PRIVATE : null;
}

/** The IPv4 address held in groups `i` and `i + 1`, each XORed with `mask`. */
function v4At(g: number[], i: number, mask = 0): Ipv4 {
  const hi = (g[i] ?? 0) ^ mask;
  const lo = (g[i + 1] ?? 0) ^ mask;
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/**
 * The IPv4 addresses an IPv6 address stands for: IPv4-mapped, IPv4-compatible, NAT64
 * (`64:ff9b::/96` and the local-use `64:ff9b:1::/48`), 6to4 (`2002::/16`, the address in groups 1
 * and 2) and Teredo (`2001::/32`, the server in groups 2 and 3 and the client, stored inverted, in
 * groups 6 and 7).
 */
function embeddedIpv4(g: number[]): Ipv4[] {
  const at = (i: number): number => g[i] ?? 0;
  const zeros = (from: number, to: number): boolean => g.slice(from, to).every((n) => n === 0);
  if (zeros(0, 5) && at(5) === 0xffff) return [v4At(g, 6)];
  if (zeros(0, 6) && at(6) !== 0) return [v4At(g, 6)];
  if (at(0) === 0x64 && at(1) === 0xff9b && (zeros(2, 6) || at(2) === 1)) return [v4At(g, 6)];
  if (at(0) === 0x2002) return [v4At(g, 1)];
  if (at(0) === 0x2001 && at(1) === 0) return [v4At(g, 2), v4At(g, 6, 0xffff)];
  return [];
}

/** Why an IPv6 address is refused, or null. An embedded IPv4 address is checked as IPv4. */
function ipv6Problem(g: number[], denyPrivate: boolean): string | null {
  const at = (i: number): number => g[i] ?? 0;
  const zeros = (from: number, to: number): boolean => g.slice(from, to).every((n) => n === 0);
  for (const v4 of embeddedIpv4(g)) {
    const embedded = ipv4Problem(v4, denyPrivate);
    if (embedded) return embedded;
  }
  const metadata = at(0) === 0xfd00 && at(1) === 0x0ec2 && zeros(2, 7) && at(7) === 0x254;
  if ((at(0) & 0xffc0) === 0xfe80 || metadata) return LINK_LOCAL_OR_METADATA;
  if (!denyPrivate) return null;
  const unspecified = zeros(0, 8);
  const loopback = zeros(0, 7) && at(7) === 1;
  const uniqueLocal = (at(0) & 0xfe00) === 0xfc00;
  const siteLocal = (at(0) & 0xffc0) === 0xfec0;
  const localNat64 = at(0) === 0x64 && at(1) === 0xff9b && at(2) === 1;
  return unspecified || loopback || uniqueLocal || siteLocal || localNat64
    ? LOOPBACK_OR_PRIVATE
    : null;
}

/**
 * Why `hostname` (as `URL.hostname` prints it, or an address a resolver returned) is refused, or
 * null: an IPv4 or IPv6 literal in any spelling the URL parser normalises, or one of the names
 * that always mean the local machine or a metadata service. A DNS name is not resolved here.
 */
export function hostProblem(hostname: string, denyPrivate: boolean): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  const v4 = parseIpv4(host);
  if (v4) return ipv4Problem(v4, denyPrivate);
  const v6 = parseIpv6(host);
  if (v6) return ipv6Problem(v6, denyPrivate);
  if (METADATA_HOSTNAMES.has(host)) return LINK_LOCAL_OR_METADATA;
  if (denyPrivate && (LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost"))) {
    return LOOPBACK_OR_PRIVATE;
  }
  return null;
}

// jscpd:ignore-end
