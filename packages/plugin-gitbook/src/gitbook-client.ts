// GitBook API transport, `fetch` only.
//
// Six calls cover the publisher: list the pages of a space, read one page as markdown, open a
// change request, apply a batch of content changes to it, merge it and (when a push fails) archive
// it. The API token goes in the Authorization header and nowhere else; every error message passes
// through the `mask` callback before it leaves this module. Redirects are refused, so the token
// never follows a Location header to another host. A 429 means the request was not processed, so
// it is repeated after its `Retry-After` (at most 5 times, each wait capped).

export const DEFAULT_GITBOOK_URL = "https://api.gitbook.com/v1";
export const GITBOOK_HOST = "api.gitbook.com";
const GITBOOK_PATH = "/v1";

/** Largest JSON response read. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Largest error body read; only the first 500 characters reach a message. */
const MAX_ERROR_BYTES = 64 * 1024;
/** Pages read from one space listing; a bigger tree is refused. */
export const MAX_LISTED_PAGES = 20_000;
const MAX_TREE_DEPTH = 32;

/** Ids GitBook hands out are short alphanumeric strings; anything else is refused before it reaches a URL or a body. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Longest an API call (request and response body) may take. */
export const API_TIMEOUT_MS = 30_000;
/** Longest a content batch (screenshots included) may take. */
export const CONTENT_TIMEOUT_MS = 120_000;
/** Retries of a request GitBook answered with 429. */
export const MAX_RETRIES = 5;
/** Longest a single wait before a retry, whatever `Retry-After` says. */
export const MAX_RETRY_WAIT_MS = 30_000;

export interface GitBookClientOptions {
  /** Timeout of an API call, in ms. Default {@link API_TIMEOUT_MS}. Set by tests; config cannot reach it. */
  apiTimeoutMs?: number;
  /** Timeout of a content batch, in ms. Default {@link CONTENT_TIMEOUT_MS}. */
  contentTimeoutMs?: number;
  /** Cap of one retry wait after a 429, in ms. Default {@link MAX_RETRY_WAIT_MS}. */
  maxRetryWaitMs?: number;
  /** Replaces the timer behind a retry wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GitBookUrlOptions {
  /** Accept `http:` on a loopback host. For tests that run a fake GitBook server; never set in production. */
  allowLoopbackHttp?: boolean;
}

/**
 * Validate a `base_url` and return it without trailing slashes. It must be `https:` on
 * `api.gitbook.com`, default port, path `/v1`, no credentials, query or fragment. `http:` on a
 * loopback host passes only under `allowLoopbackHttp`. The token is sent to whatever this accepts.
 */
export function assertGitBookBaseUrl(raw: string, options: GitBookUrlOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("gitbook: config.base_url is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("gitbook: config.base_url must not contain credentials");
  }
  const loopback =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback && !(url.protocol === "https:" && url.hostname === GITBOOK_HOST)) {
    throw new Error(`gitbook: config.base_url must be https on ${GITBOOK_HOST}`);
  }
  // `URL.port` is empty for the scheme's default port, so `:443` passes and any other port does not.
  if (!loopback && url.port !== "") {
    throw new Error("gitbook: config.base_url must use the default https port");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== GITBOOK_PATH || url.search !== "" || url.hash !== "") {
    throw new Error(`gitbook: config.base_url path must be ${GITBOOK_PATH}`);
  }
  return `${url.origin}${path}`;
}

/** True for an `https:` URL on GitBook's app host, with no credentials or port. */
export function isGitBookAppUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "app.gitbook.com" &&
      !url.username &&
      !url.password &&
      url.port === ""
    );
  } catch {
    return false;
  }
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
  const refuse = () => new Error(`gitbook: response body is over ${maxBytes} bytes`);
  const declared = Number(res.headers.get("content-length"));
  if (!truncate && declared > maxBytes) throw refuse();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let kept = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const room = maxBytes - kept;
    if (next.value.byteLength > room) {
      await reader.cancel();
      if (!truncate) throw refuse();
      parts.push(next.value.subarray(0, room));
      break;
    }
    parts.push(next.value);
    kept += next.value.byteLength;
  }
  return Buffer.concat(parts).toString("utf8");
}

/** A page in a space's tree: documents, and the groups that hold more of them. */
export interface LivePage {
  id: string;
  title: string;
  type: string;
  appUrl?: string;
  pages: LivePage[];
}

/** One entry of a content batch. The shapes are GitBook's `ChangeRequestContentChange`. */
export type ContentChange =
  | {
      operation: "insert_files";
      files: Array<{ ref: string; name: string; contentType: string; base64: string }>;
    }
  | {
      operation: "insert_page";
      title: string;
      slug?: string;
      into?: string;
      hidden?: boolean;
      noIndex?: boolean;
      noRobotsIndex?: boolean;
      document: { markdown: string };
    }
  | {
      operation: "update_page";
      page: string;
      title: string;
      document: { markdown: string };
    };

/** Pages a batch touched, as GitBook reports them. */
export interface AppliedChanges {
  created: string[];
  updated: string[];
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usableId(value: unknown, what: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`gitbook: ${what} did not return a usable id`);
  }
  return value;
}

export class GitBookClient {
  private readonly baseUrl: string;
  private readonly apiTimeoutMs: number;
  private readonly contentTimeoutMs: number;
  private readonly maxRetryWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly mask: (s: string) => string,
    options: GitBookUrlOptions & GitBookClientOptions = {},
  ) {
    // Checked again here so no caller can hand the token to another host.
    this.baseUrl = assertGitBookBaseUrl(baseUrl, options);
    this.apiTimeoutMs = options.apiTimeoutMs ?? API_TIMEOUT_MS;
    this.contentTimeoutMs = options.contentTimeoutMs ?? CONTENT_TIMEOUT_MS;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? MAX_RETRY_WAIT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Wait before retry `attempt` (0-based): `Retry-After` seconds, else 1 s doubling, capped. */
  private retryWait(header: string | null, attempt: number): number {
    const seconds = header === null || header.trim() === "" ? NaN : Number(header);
    const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
    return Math.min(ms, this.maxRetryWaitMs);
  }

  private async send(
    method: "GET" | "POST" | "PATCH",
    path: string,
    label: string,
    body?: unknown,
    timeoutMs = this.apiTimeoutMs,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          redirect: "error",
          // Covers the response body too, so a server that stalls mid-body ends the call as well.
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (e) {
        if (isTimeout(e)) {
          throw new Error(`gitbook: ${method} ${label} timed out after ${timeoutMs} ms`);
        }
        throw new Error(this.mask(`gitbook: ${method} ${label} failed: ${(e as Error).message}`));
      }
      if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
      // GitBook rejected the request unprocessed, so repeating a write is safe.
      const wait = this.retryWait(res.headers.get("retry-after"), attempt);
      await res.body?.cancel().catch(() => undefined);
      await this.sleep(wait);
    }
  }

  /** A bounded body read that names a timeout the same way {@link send} does. */
  private async read(
    method: string,
    label: string,
    res: Response,
    maxBytes: number,
    truncate = false,
  ): Promise<string> {
    try {
      return await readBoundedText(res, maxBytes, truncate);
    } catch (e) {
      if (isTimeout(e)) {
        throw new Error(`gitbook: ${method} ${label} timed out reading the response`);
      }
      throw e;
    }
  }

  private async fail(method: string, label: string, res: Response): Promise<never> {
    const text = await this.read(method, label, res, MAX_ERROR_BYTES, true);
    throw new Error(
      this.mask(`gitbook: ${method} ${label} returned HTTP ${res.status}: ${text.slice(0, 500)}`),
    );
  }

  private async json(method: string, label: string, res: Response): Promise<unknown> {
    const text = await this.read(method, label, res, MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(this.mask(`gitbook: ${method} ${label} returned a body that is not JSON`));
    }
  }

  /** The live page tree of a space. */
  async listPages(spaceId: string): Promise<LivePage[]> {
    const label = "/spaces/{id}/content/pages";
    const res = await this.send(
      "GET",
      `/spaces/${encodeURIComponent(spaceId)}/content/pages`,
      label,
    );
    if (!res.ok) return this.fail("GET", label, res);
    const body = await this.json("GET", label, res);
    const list: unknown = isObject(body) ? body["pages"] : undefined;
    if (!Array.isArray(list)) {
      throw new Error(`gitbook: GET ${label} did not return a page list`);
    }
    return readPages(list, 0, { left: MAX_LISTED_PAGES });
  }

  /** A page's content as markdown, or null when the page does not exist. */
  async getPageMarkdown(spaceId: string, pageId: string): Promise<string | null> {
    const label = "/spaces/{id}/content/page/{id}";
    const res = await this.send(
      "GET",
      `/spaces/${encodeURIComponent(spaceId)}/content/page/${encodeURIComponent(pageId)}?format=markdown`,
      label,
    );
    if (res.status === 404) return null;
    if (!res.ok) return this.fail("GET", label, res);
    const body = await this.json("GET", label, res);
    return isObject(body) && typeof body["markdown"] === "string" ? body["markdown"] : "";
  }

  async createChangeRequest(spaceId: string, subject: string): Promise<string> {
    const label = "/spaces/{id}/change-requests";
    const res = await this.send(
      "POST",
      `/spaces/${encodeURIComponent(spaceId)}/change-requests`,
      label,
      { subject },
    );
    if (!res.ok) return this.fail("POST", label, res);
    const body = await this.json("POST", label, res);
    const id = isObject(body) ? body["id"] : undefined;
    if (typeof id === "string" && id !== "" && id.length <= 256 && !ID_PATTERN.test(id)) {
      // The draft exists and the publisher will never see its id, so close it here.
      await this.archive(spaceId, id).catch(() => undefined);
    }
    return usableId(id, `POST ${label}`);
  }

  /** Applies one ordered batch atomically (GitBook takes at most 50 changes) and names the pages it touched. */
  async applyChanges(
    spaceId: string,
    changeRequestId: string,
    changes: ContentChange[],
  ): Promise<AppliedChanges> {
    const label = "/spaces/{id}/change-requests/{id}/content";
    const res = await this.send(
      "POST",
      `/spaces/${encodeURIComponent(spaceId)}/change-requests/${encodeURIComponent(changeRequestId)}/content?compat=false`,
      label,
      { changes },
      this.contentTimeoutMs,
    );
    if (!res.ok) return this.fail("POST", label, res);
    const body = await this.json("POST", label, res);
    const applied: AppliedChanges = { created: [], updated: [] };
    const listed: unknown = isObject(body) ? body["changes"] : undefined;
    for (const entry of Array.isArray(listed) ? (listed as unknown[]) : []) {
      if (!isObject(entry) || !isObject(entry["page"])) continue;
      const id = usableId(entry["page"]["id"], `POST ${label}`);
      if (entry["object"] === "created_page") applied.created.push(id);
      else if (entry["object"] === "updated_page") applied.updated.push(id);
    }
    return applied;
  }

  /** Merges a change request into the space's live content. `conflicts` means GitBook applied it anyway. */
  async merge(spaceId: string, changeRequestId: string): Promise<"merge" | "conflicts"> {
    const label = "/spaces/{id}/change-requests/{id}/merge";
    const res = await this.send(
      "POST",
      `/spaces/${encodeURIComponent(spaceId)}/change-requests/${encodeURIComponent(changeRequestId)}/merge`,
      label,
      {},
      this.contentTimeoutMs,
    );
    if (!res.ok) return this.fail("POST", label, res);
    const body = await this.json("POST", label, res);
    return isObject(body) && body["result"] === "conflicts" ? "conflicts" : "merge";
  }

  /** Archives a change request so a failed push leaves no open draft behind. */
  async archive(spaceId: string, changeRequestId: string): Promise<void> {
    const label = "/spaces/{id}/change-requests/{id}";
    const res = await this.send(
      "PATCH",
      `/spaces/${encodeURIComponent(spaceId)}/change-requests/${encodeURIComponent(changeRequestId)}`,
      label,
      { status: "archived" },
    );
    if (!res.ok) await this.fail("PATCH", label, res);
    await this.read("PATCH", label, res, MAX_RESPONSE_BYTES);
  }
}

function readPages(items: unknown[], depth: number, budget: { left: number }): LivePage[] {
  if (depth > MAX_TREE_DEPTH) throw new Error("gitbook: the page tree is nested too deep");
  const pages: LivePage[] = [];
  for (const item of items) {
    if (!isObject(item)) continue;
    if (--budget.left < 0) throw new Error(`gitbook: the space has over ${MAX_LISTED_PAGES} pages`);
    const children = Array.isArray(item["pages"])
      ? readPages(item["pages"], depth + 1, budget)
      : [];
    const id = item["id"];
    if (typeof id !== "string" || !ID_PATTERN.test(id)) continue;
    const urls = item["urls"];
    const appUrl = isObject(urls) ? urls["app"] : undefined;
    pages.push({
      id,
      title: typeof item["title"] === "string" ? item["title"] : "",
      type: typeof item["type"] === "string" ? item["type"] : "",
      ...(isGitBookAppUrl(appUrl) ? { appUrl } : {}),
      pages: children,
    });
  }
  return pages;
}
