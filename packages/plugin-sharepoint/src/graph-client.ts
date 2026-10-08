// Microsoft Graph transport for one SharePoint document library, `fetch` only.
//
// Two operations are enough for the publisher: read a file's content by path and upload a
// file by path (simple upload, `PUT .../root:/<path>:/content`). The bearer token goes in the
// Authorization header of requests to the Graph host and nowhere else; every error message
// passes through the `mask` callback before it leaves this module.
//
// Graph answers `GET .../content` with a redirect to a pre-authenticated download URL on a
// SharePoint host. A read follows exactly that one hop, without the Authorization header, and
// only to https on a SharePoint domain. A write never follows a redirect.

export const DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0";

/** Graph endpoints the bearer token may be sent to: the public cloud and the three national clouds. */
export const GRAPH_HOSTS: readonly string[] = [
  "graph.microsoft.com",
  "graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
  "graph.microsoft.de",
];

/** Largest remote manifest read. */
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** Largest JSON response read from an upload. */
export const MAX_JSON_BYTES = 1024 * 1024;
/** Largest error body read; only the first 500 characters reach a message. */
const MAX_ERROR_BYTES = 64 * 1024;
/** Deadline of an API call, body read included. */
export const API_TIMEOUT_MS = 30_000;
/** Deadline of an upload, body read included. */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** SharePoint domains a download URL can be on: the public cloud and the national clouds. */
export const SHAREPOINT_DOMAINS: readonly string[] = [
  "sharepoint.com",
  "sharepoint.us",
  "sharepoint.cn",
  "sharepoint.de",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Paths a `graph_base_url` can have: the stable and the preview API versions. */
const GRAPH_PATHS: readonly string[] = ["/v1.0", "/beta"];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GraphUrlOptions {
  /**
   * Accept `http:` on a loopback host, for the Graph endpoint and for the download hop of a read.
   * For tests that run a fake Graph server; never set in production.
   */
  allowLoopbackHttp?: boolean;
}

export interface GraphClientOptions {
  /** Deadline of an API call in milliseconds. Default {@link API_TIMEOUT_MS}. */
  apiTimeoutMs?: number;
  /** Deadline of an upload in milliseconds. Default {@link UPLOAD_TIMEOUT_MS}. */
  uploadTimeoutMs?: number;
}

/** True when `raw` carries a query or fragment, including an empty one that `URL` drops. */
function hasQueryOrFragment(raw: string, url: URL): boolean {
  return url.search !== "" || url.hash !== "" || raw.includes("?") || raw.includes("#");
}

/**
 * Validate a `graph_base_url` and return its origin plus path, without trailing slashes. It must
 * be `https:` on one of {@link GRAPH_HOSTS} with no credentials, query or fragment, and the path
 * is `/v1.0` or `/beta`; `http:` on a loopback host passes only under `allowLoopbackHttp`. A Graph
 * host takes no port other than the default one. The bearer token is sent to whatever this accepts.
 */
export function assertGraphBaseUrl(raw: string, options: GraphUrlOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("sharepoint: config.graph_base_url is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("sharepoint: config.graph_base_url must not contain credentials");
  }
  const loopback =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback && !(url.protocol === "https:" && GRAPH_HOSTS.includes(url.hostname))) {
    throw new Error(
      `sharepoint: config.graph_base_url must be https on one of ${GRAPH_HOSTS.join(", ")}`,
    );
  }
  // `URL.port` is empty for the scheme's default port, so `:443` passes and any other port does not.
  if (!loopback && url.port !== "") {
    throw new Error("sharepoint: config.graph_base_url must use the default https port");
  }
  if (hasQueryOrFragment(raw, url)) {
    throw new Error("sharepoint: config.graph_base_url must not carry a query or fragment");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!GRAPH_PATHS.includes(pathname)) {
    throw new Error(`sharepoint: config.graph_base_url path must be ${GRAPH_PATHS.join(" or ")}`);
  }
  return `${url.origin}${pathname}`;
}

/**
 * True for the one place a read may be redirected to: `https:` on a subdomain of a SharePoint
 * domain, no credentials, default port. Under `allowLoopbackHttp` plain http on loopback also
 * passes, for the fake server in tests.
 */
export function isDownloadUrl(value: string, options: GraphUrlOptions = {}): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (options.allowLoopbackHttp === true && url.protocol === "http:") {
    return LOOPBACK_HOSTS.has(url.hostname);
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    SHAREPOINT_DOMAINS.some((d) => url.hostname.endsWith(`.${d}`))
  );
}

/**
 * The response body as text, refused when it is over `maxBytes`. With `truncate` the body is cut at
 * the limit instead (for error bodies that only feed a message).
 */
export async function readBoundedText(
  res: Response,
  maxBytes: number,
  truncate = false,
): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`sharepoint: response body is over ${maxBytes} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      if (!truncate) throw new Error(`sharepoint: response body is over ${maxBytes} bytes`);
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
}

export interface LibraryRef {
  /** `drives/{id}` for a library id, `sites/{id}/drive` for a site's default library. */
  root: string;
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export class GraphClient {
  private readonly baseUrl: string;
  private readonly apiTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly allowLoopbackHttp: boolean;

  constructor(
    baseUrl: string,
    private readonly library: LibraryRef,
    private readonly token: string,
    private readonly mask: (s: string) => string,
    options: GraphUrlOptions & GraphClientOptions = {},
  ) {
    // Checked again here so no caller can hand the token to another host.
    this.baseUrl = assertGraphBaseUrl(baseUrl, options);
    this.allowLoopbackHttp = options.allowLoopbackHttp === true;
    this.apiTimeoutMs = options.apiTimeoutMs ?? API_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  }

  private itemUrl(itemPath: string): string {
    const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/${this.library.root}/root:/${encoded}:/content`;
  }

  /** A timeout names itself; any other failure is masked. */
  private failure(what: string, e: unknown, timeoutMs: number): Error {
    if (isTimeout(e)) return new Error(`sharepoint: ${what} timed out after ${timeoutMs} ms`);
    return new Error(this.mask(`sharepoint: ${what} failed: ${(e as Error).message}`));
  }

  /**
   * One request to the Graph host. The signal covers the response body as well, so a server that
   * stalls mid-body ends the call too. A write never follows a redirect; a read gets the 3xx back
   * so {@link follow} can decide.
   */
  private async send(
    method: "GET" | "PUT",
    itemPath: string,
    signal: AbortSignal,
    timeoutMs: number,
    body?: { data: Uint8Array; contentType: string },
  ): Promise<Response> {
    const query = method === "PUT" ? "?@microsoft.graph.conflictBehavior=replace" : "";
    try {
      return await fetch(`${this.itemUrl(itemPath)}${query}`, {
        method,
        redirect: method === "GET" ? "manual" : "error",
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body ? { "content-type": body.contentType } : {}),
        },
        ...(body ? { body: new Blob([body.data], { type: body.contentType }) } : {}),
      });
    } catch (e) {
      throw this.failure(`${method} ${itemPath}`, e, timeoutMs);
    }
  }

  /**
   * The download hop of a read: one GET to the `Location` of a redirect, without the bearer token,
   * only when {@link isDownloadUrl} accepts it. A second redirect is an error.
   */
  private async follow(
    itemPath: string,
    redirect: Response,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Response> {
    await redirect.body?.cancel();
    let target = "";
    try {
      target = new URL(redirect.headers.get("location") ?? "", this.baseUrl).toString();
    } catch {
      // An unusable Location is refused below like any other.
    }
    if (!isDownloadUrl(target, { allowLoopbackHttp: this.allowLoopbackHttp })) {
      throw new Error(
        `sharepoint: GET ${itemPath} was redirected to a host that is not a SharePoint download URL`,
      );
    }
    let res: Response;
    try {
      res = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { accept: "*/*" },
      });
    } catch (e) {
      throw this.failure(`GET ${itemPath} (download)`, e, timeoutMs);
    }
    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel();
      throw new Error(`sharepoint: GET ${itemPath} download URL redirected again, refusing`);
    }
    return res;
  }

  /** A bounded body read that names a timeout the same way {@link send} does. */
  private async read(
    what: string,
    res: Response,
    maxBytes: number,
    truncate = false,
  ): Promise<string> {
    try {
      return await readBoundedText(res, maxBytes, truncate);
    } catch (e) {
      if (isTimeout(e)) throw new Error(`sharepoint: ${what} timed out reading the response`);
      throw e;
    }
  }

  private async fail(method: string, itemPath: string, res: Response): Promise<never> {
    const text = await this.read(`${method} ${itemPath}`, res, MAX_ERROR_BYTES, true);
    // Masked before the cut, so a token that straddles character 500 is never half-shown.
    throw new Error(
      this.mask(`sharepoint: ${method} ${itemPath} returned HTTP ${res.status}: `) +
        this.mask(text).slice(0, 500),
    );
  }

  /**
   * File content as text (at most 8 MiB), or null when the item does not exist. A redirect to a
   * SharePoint download URL is followed once, without the bearer token.
   */
  async readText(itemPath: string): Promise<string | null> {
    const timeoutMs = this.apiTimeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    let res = await this.send("GET", itemPath, signal, timeoutMs);
    if (REDIRECT_STATUSES.has(res.status))
      res = await this.follow(itemPath, res, signal, timeoutMs);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail("GET", itemPath, res, timeoutMs);
    return this.read(`GET ${itemPath}`, res, MAX_MANIFEST_BYTES, timeoutMs);
  }

  async upload(itemPath: string, data: Uint8Array, contentType: string): Promise<DriveItem> {
    const timeoutMs = this.uploadTimeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await this.send("PUT", itemPath, signal, timeoutMs, { data, contentType });
    if (!res.ok) return this.fail("PUT", itemPath, res);
    return JSON.parse(await this.read(`PUT ${itemPath}`, res, MAX_JSON_BYTES)) as DriveItem;
  }
}
