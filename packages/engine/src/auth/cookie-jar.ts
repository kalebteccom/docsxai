// Minimal RFC-6265 cookie jar for the pure-HTTP strategies (api-login, test-backdoor).
//
// Strategies that log in over plain `fetch` must collect `Set-Cookie` headers across the login's
// redirect chain themselves (fetch's `redirect: "follow"` drops them). The jar parses the
// attributes Playwright's `storageState` needs and replays matching cookies on each hop.

import { AuthStrategyConfigError, type StorageState, type StorageStateCookie } from "./types.js";

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** RFC 6265 §5.1.4 default-path: the request path's directory. */
function defaultPath(requestUrl: URL): string {
  const p = requestUrl.pathname;
  if (!p.startsWith("/")) return "/";
  const lastSlash = p.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : p.slice(0, lastSlash);
}

/**
 * Parse one `Set-Cookie` header into a {@link StorageStateCookie}.
 * Domain defaults to the request host (host-only); a `Domain` attribute gets the conventional
 * leading dot (subdomain-matching, mirroring Playwright's representation). `Max-Age` beats
 * `Expires`; absent both, the cookie is a session cookie (`expires: -1`).
 * Returns `null` for an unparsable header.
 */
export function parseSetCookie(
  header: string,
  requestUrl: URL,
  now = Date.now(),
): StorageStateCookie | null {
  const segments = header.split(";");
  const nameValue = segments[0] ?? "";
  const eq = nameValue.indexOf("=");
  if (eq <= 0) return null;
  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1).trim();
  if (!name) return null;

  let domain = requestUrl.hostname;
  let path: string | undefined;
  let expires = -1;
  let maxAge: number | undefined;
  let httpOnly = false;
  let secure = false;
  let sameSite: StorageStateCookie["sameSite"] = "Lax";

  for (const segment of segments.slice(1)) {
    const sepIdx = segment.indexOf("=");
    const key = (sepIdx === -1 ? segment : segment.slice(0, sepIdx)).trim().toLowerCase();
    const val = sepIdx === -1 ? "" : segment.slice(sepIdx + 1).trim();
    switch (key) {
      case "domain":
        if (val) domain = "." + val.replace(/^\./, "").toLowerCase();
        break;
      case "path":
        if (val.startsWith("/")) path = val;
        break;
      case "expires": {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = Math.floor(t / 1000);
        break;
      }
      case "max-age": {
        const n = Number(val);
        if (Number.isFinite(n)) maxAge = n;
        break;
      }
      case "httponly":
        httpOnly = true;
        break;
      case "secure":
        secure = true;
        break;
      case "samesite": {
        const v = val.toLowerCase();
        sameSite = v === "strict" ? "Strict" : v === "none" ? "None" : "Lax";
        break;
      }
    }
  }
  if (maxAge !== undefined) expires = maxAge <= 0 ? 0 : Math.floor(now / 1000) + maxAge;

  return {
    name,
    value,
    domain,
    path: path ?? defaultPath(requestUrl),
    expires,
    httpOnly,
    secure,
    sameSite,
  };
}

function domainMatches(hostname: string, cookieDomain: string): boolean {
  if (cookieDomain.startsWith(".")) {
    const bare = cookieDomain.slice(1);
    return hostname === bare || hostname.endsWith(cookieDomain);
  }
  return hostname === cookieDomain;
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export class CookieJar {
  private readonly store = new Map<string, StorageStateCookie>();

  private key(c: StorageStateCookie): string {
    return `${c.name}\u0000${c.domain}\u0000${c.path}`;
  }

  /** Store a cookie; an already-expired one (`Max-Age=0` deletion) removes the match instead. */
  add(cookie: StorageStateCookie, now = Date.now()): void {
    // `expires: -1` is a session cookie (kept); `0` is the Max-Age<=0 deletion marker.
    if (cookie.expires >= 0 && cookie.expires * 1000 <= now) {
      this.store.delete(this.key(cookie));
      return;
    }
    this.store.set(this.key(cookie), cookie);
  }

  /** Parse + store every `Set-Cookie` header from one response. */
  addFromHeaders(setCookieHeaders: string[], requestUrl: URL, now = Date.now()): void {
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header, requestUrl, now);
      if (cookie) this.add(cookie, now);
    }
  }

  /** First stored cookie with this name, regardless of domain/path. */
  get(name: string): StorageStateCookie | undefined {
    for (const c of this.store.values()) if (c.name === name) return c;
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  cookies(): StorageStateCookie[] {
    return [...this.store.values()];
  }

  /** `Cookie:` header value for a request to `url`, domain/path/secure/expiry-matched. Empty string if none apply. */
  cookieHeaderFor(url: URL, now = Date.now()): string {
    const sendable = this.cookies().filter((c) => {
      if (c.expires > 0 && c.expires * 1000 <= now) return false;
      if (c.secure && url.protocol !== "https:" && !isLoopback(url.hostname)) return false;
      return domainMatches(url.hostname, c.domain) && pathMatches(url.pathname || "/", c.path);
    });
    return sendable.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  toStorageState(): StorageState {
    return { cookies: this.cookies(), origins: [] };
  }
}

export interface CollectingFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface CollectingFetchResult {
  jar: CookieJar;
  /** Final (post-redirect) response status. */
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Final response body text. */
  body: string;
  /** Redirect hops followed. */
  hops: number;
}

/**
 * Fetch with `redirect: "manual"`, following up to `maxRedirects` hops (default 5) while
 * collecting `Set-Cookie` headers into a {@link CookieJar} and replaying matching cookies on
 * each hop. 303, and 301/302 on a non-GET, switch the method to GET and drop the body,
 * matching browser behaviour.
 */
export async function fetchCollectingCookies(
  url: string | URL,
  init: CollectingFetchInit = {},
  opts: {
    maxRedirects?: number;
    jar?: CookieJar;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<CollectingFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const jar = opts.jar ?? new CookieJar();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  let current = new URL(url);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers: Record<string, string> = { ...(init.headers ?? {}) };

  for (let hops = 0; ; hops++) {
    const cookieHeader = jar.cookieHeaderFor(current, now());
    const response = await fetchImpl(current, {
      method,
      headers: { ...headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      ...(body !== undefined ? { body } : {}),
      redirect: "manual",
    });
    jar.addFromHeaders(response.headers.getSetCookie(), current, now());

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location !== null;
    if (!isRedirect) {
      return { jar, status: response.status, url: current.href, body: await response.text(), hops };
    }
    await response.body?.cancel();
    if (hops >= maxRedirects) {
      throw new AuthStrategyConfigError(
        `redirect chain from ${new URL(url).href} exceeded ${maxRedirects} hops (stuck at ${current.href})`,
      );
    }
    current = new URL(location, current);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method !== "GET")
    ) {
      method = "GET";
      body = undefined;
      const { ["content-type"]: _dropped, ...rest } = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
      );
      headers = rest;
    }
  }
}

/**
 * The expiry a login strategy can credibly report: the named cookie's expiry when the caller
 * knows which cookie is the session, else, only when the jar has exactly one real-expiry
 * cookie: that one. Ambiguous jars report `undefined` (the cache's `ttl` takes over).
 */
export function jarAuthExpiry(state: StorageState, preferredCookie?: string): number | undefined {
  if (preferredCookie) {
    const c = state.cookies.find((x) => x.name === preferredCookie && x.expires > 0);
    return c ? c.expires * 1000 : undefined;
  }
  const real = state.cookies.filter((c) => c.expires > 0);
  return real.length === 1 ? real[0]!.expires * 1000 : undefined;
}
