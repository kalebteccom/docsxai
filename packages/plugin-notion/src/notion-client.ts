// Notion public API transport, `fetch` only.
//
// The bearer token goes in the Authorization header and nowhere else; every error message passes
// through the `mask` callback before it leaves this module. Redirects are refused, so the token
// never follows a Location header to another host. Notion allows about 3 requests a second per
// connection: calls are spaced out, and a 429 is retried after its `Retry-After`, a bounded
// number of times.

export const DEFAULT_NOTION_URL = "https://api.notion.com/v1";
export const NOTION_HOST = "api.notion.com";
const NOTION_PATH = "/v1";

/** Pinned. `database_id` parents (config.database_id) work on this version and not on 2025-09-03 and later. */
export const NOTION_VERSION = "2022-06-28";

/** Largest JSON response read. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Largest error body read; only the first 500 characters reach a message. */
const MAX_ERROR_BYTES = 64 * 1024;

/** Longest an API call (request and response body) may take. */
export const API_TIMEOUT_MS = 30_000;
/** Longest a file upload may take. */
export const UPLOAD_TIMEOUT_MS = 120_000;
/** Retries of a request Notion answered with 429. */
export const MAX_RETRIES = 5;
/** Longest a single wait before a retry, whatever `Retry-After` says. */
export const MAX_RETRY_WAIT_MS = 30_000;
/** Spacing between requests: 3 a second on average. */
export const MIN_INTERVAL_MS = 350;
/** Pages of 100 children read for one listing. */
export const MAX_LIST_PAGES = 20;
/** Rounds of list-then-delete when emptying a page. */
const MAX_CLEAR_ROUNDS = 50;
/** Notion takes 100 blocks and 500 KB per append; the byte budget keeps some room. */
const MAX_BATCH_BLOCKS = 100;
const MAX_BATCH_BYTES = 400_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface NotionClientOptions {
  /** Timeout of an API call, in ms. Set by tests; config cannot reach it. */
  apiTimeoutMs?: number;
  /** Timeout of a file upload, in ms. */
  uploadTimeoutMs?: number;
  /** Spacing between requests, in ms. Default {@link MIN_INTERVAL_MS}. */
  minIntervalMs?: number;
  /** Cap of one retry wait, in ms. Default {@link MAX_RETRY_WAIT_MS}. */
  maxRetryWaitMs?: number;
  /** Replaces the timer behind every wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface NotionUrlOptions {
  /** Accept `http:` on a loopback host. For tests that run a fake Notion server; never set in production. */
  allowLoopbackHttp?: boolean;
}

/**
 * Validate a `base_url` and return it without trailing slashes. It must be `https:` on
 * `api.notion.com`, default port, path `/v1`, no credentials, query or fragment. `http:` on a
 * loopback host passes only under `allowLoopbackHttp`. The token is sent to whatever this accepts.
 */
export function assertNotionBaseUrl(raw: string, options: NotionUrlOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("notion: config.base_url is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("notion: config.base_url must not contain credentials");
  }
  const loopback =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback && !(url.protocol === "https:" && url.hostname === NOTION_HOST)) {
    throw new Error(`notion: config.base_url must be https on ${NOTION_HOST}`);
  }
  // `URL.port` is empty for the scheme's default port, so `:443` passes and any other port does not.
  if (!loopback && url.port !== "") {
    throw new Error("notion: config.base_url must use the default https port");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== NOTION_PATH || url.search !== "" || url.hash !== "") {
    throw new Error(`notion: config.base_url path must be ${NOTION_PATH}`);
  }
  return `${url.origin}${path}`;
}

const UUID = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;

/** A Notion id in its dashed lower-case form, or null when the value is not a UUID. */
export function normalizeId(value: unknown): string | null {
  const m = typeof value === "string" ? UUID.exec(value) : null;
  return m ? m.slice(1).join("-").toLowerCase() : null;
}

/** True for an `https:` URL on Notion's web host, with no credentials or port. */
export function isNotionUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "www.notion.so" || url.hostname === "notion.so") &&
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
  const declared = Number(res.headers.get("content-length"));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`notion: response body is over ${maxBytes} bytes`);
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
      if (!truncate) throw new Error(`notion: response body is over ${maxBytes} bytes`);
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface Parent {
  type: "page_id" | "database_id";
  id: string;
}

export interface NotionPage {
  id: string;
  url?: string;
  /** Archived or in the trash. */
  trashed: boolean;
  parent?: { type: string; id: string };
}

export interface NotionChild {
  id: string;
  type: string;
  /** Title of a `child_page` block. */
  childTitle?: string;
  /** Text of a `code` block. */
  codeText?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPage(value: unknown, what: string): NotionPage {
  const id = isObject(value) ? normalizeId(value["id"]) : null;
  if (!isObject(value) || id === null) {
    throw new Error(`notion: ${what} did not return a page with a usable id`);
  }
  const rawParent = value["parent"];
  const parentType = isObject(rawParent) ? rawParent["type"] : undefined;
  const parentId =
    isObject(rawParent) && typeof parentType === "string"
      ? normalizeId(rawParent[parentType])
      : null;
  return {
    id,
    ...(isNotionUrl(value["url"]) ? { url: value["url"] } : {}),
    trashed: value["archived"] === true || value["in_trash"] === true,
    ...(typeof parentType === "string" && parentId !== null
      ? { parent: { type: parentType, id: parentId } }
      : {}),
  };
}

function plainText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!isObject(item)) return "";
      if (typeof item["plain_text"] === "string") return item["plain_text"];
      const text = item["text"];
      return isObject(text) && typeof text["content"] === "string" ? text["content"] : "";
    })
    .join("");
}

function asChild(value: unknown): NotionChild | null {
  const id = isObject(value) ? normalizeId(value["id"]) : null;
  if (!isObject(value) || id === null || typeof value["type"] !== "string") return null;
  const type = value["type"];
  const body = value[type];
  return {
    id,
    type,
    ...(type === "child_page" && isObject(body) && typeof body["title"] === "string"
      ? { childTitle: body["title"] }
      : {}),
    ...(type === "code" && isObject(body) ? { codeText: plainText(body["rich_text"]) } : {}),
  };
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

interface Body {
  data: string | FormData;
  contentType?: string;
}

export class NotionClient {
  private readonly baseUrl: string;
  private readonly apiTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxRetryWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastAt = 0;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly mask: (s: string) => string,
    options: NotionUrlOptions & NotionClientOptions = {},
  ) {
    // Checked again here so no caller can hand the token to another host.
    this.baseUrl = assertNotionBaseUrl(baseUrl, options);
    this.apiTimeoutMs = options.apiTimeoutMs ?? API_TIMEOUT_MS;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
    this.minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? MAX_RETRY_WAIT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async pace(): Promise<void> {
    const wait = this.lastAt + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = Date.now();
  }

  /** Wait before retry `attempt` (0-based): `Retry-After` seconds, else 1 s doubling, capped. */
  private retryWait(header: string | null, attempt: number): number {
    const seconds = header === null || header.trim() === "" ? NaN : Number(header);
    const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
    return Math.min(ms, this.maxRetryWaitMs);
  }

  private async send(
    method: string,
    path: string,
    label: string,
    body: Body | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await this.pace();
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          redirect: "error",
          // Covers the response body too, so a server that stalls mid-body ends the call as well.
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            authorization: `Bearer ${this.token}`,
            "notion-version": NOTION_VERSION,
            accept: "application/json",
            ...(body?.contentType ? { "content-type": body.contentType } : {}),
          },
          ...(body ? { body: body.data } : {}),
        });
      } catch (e) {
        if (isTimeout(e)) {
          throw new Error(`notion: ${method} ${label} timed out after ${timeoutMs} ms`);
        }
        throw new Error(this.mask(`notion: ${method} ${label} failed: ${(e as Error).message}`));
      }
      if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
      // Notion rejected the request unprocessed, so repeating a write is safe.
      const wait = this.retryWait(res.headers.get("retry-after"), attempt);
      await res.body?.cancel().catch(() => undefined);
      await this.sleep(wait);
    }
  }

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
      if (isTimeout(e))
        throw new Error(`notion: ${method} ${label} timed out reading the response`);
      throw e;
    }
  }

  /** One call: the parsed JSON body, or null for a 404 when `allow404`. Any other failure throws. */
  private async call(
    method: string,
    path: string,
    label: string,
    body?: Body,
    opts: { allow404?: boolean; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const res = await this.send(method, path, label, body, opts.timeoutMs ?? this.apiTimeoutMs);
    if (res.status === 404 && opts.allow404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!res.ok) {
      const text = await this.read(method, label, res, MAX_ERROR_BYTES, true);
      throw new Error(
        this.mask(`notion: ${method} ${label} returned HTTP ${res.status}: ${text.slice(0, 500)}`),
      );
    }
    const text = await this.read(method, label, res, MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(this.mask(`notion: ${method} ${label} returned a body that is not JSON`));
    }
  }

  private json(value: unknown): Body {
    return { data: JSON.stringify(value), contentType: "application/json" };
  }

  async createPage(parent: Parent, properties: Record<string, unknown>): Promise<NotionPage> {
    const label = "/pages";
    const body = { parent: { [parent.type]: parent.id }, properties };
    return asPage(await this.call("POST", label, label, this.json(body)), `POST ${label}`);
  }

  /** A page, or null when it does not exist. */
  async getPage(id: string): Promise<NotionPage | null> {
    const label = "/pages/{id}";
    const found = await this.call("GET", `/pages/${id}`, label, undefined, { allow404: true });
    return found === null ? null : asPage(found, `GET ${label}`);
  }

  async setProperties(id: string, properties: Record<string, unknown>): Promise<void> {
    await this.call("PATCH", `/pages/${id}`, "/pages/{id}", this.json({ properties }));
  }

  /** One page of up to 100 children of a page or block. */
  async listChildren(
    id: string,
    cursor?: string,
  ): Promise<{ children: NotionChild[]; next: string | null }> {
    const label = "/blocks/{id}/children";
    const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await this.call("GET", `/blocks/${id}/children?${query}`, label);
    const results = isObject(body) ? body["results"] : undefined;
    if (!isObject(body) || !Array.isArray(results)) {
      throw new Error(`notion: GET ${label} did not return a list`);
    }
    const next = body["next_cursor"];
    return {
      children: results.map(asChild).filter((c): c is NotionChild => c !== null),
      next:
        body["has_more"] === true &&
        typeof next === "string" &&
        next.length > 0 &&
        next.length <= 512
          ? next
          : null,
    };
  }

  /** Every child of a block, up to {@link MAX_LIST_PAGES} pages; `truncated` when there was more. */
  async readChildren(id: string): Promise<{ children: NotionChild[]; truncated: boolean }> {
    const children: NotionChild[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const batch = await this.listChildren(id, cursor);
      children.push(...batch.children);
      if (batch.next === null) return { children, truncated: false };
      cursor = batch.next;
    }
    return { children, truncated: true };
  }

  async deleteBlock(id: string): Promise<void> {
    await this.call("DELETE", `/blocks/${id}`, "/blocks/{id}");
  }

  /**
   * Deletes the content blocks of a page. A `child_page` or `child_database` block is a page
   * somebody nested under it, so those stay.
   */
  async clearChildren(id: string): Promise<void> {
    const gone = new Set<string>();
    for (let round = 0; round < MAX_CLEAR_ROUNDS; round++) {
      const { children } = await this.listChildren(id);
      const fresh = children.filter(
        (c) => !gone.has(c.id) && c.type !== "child_page" && c.type !== "child_database",
      );
      if (fresh.length === 0) return;
      for (const child of fresh) {
        await this.deleteBlock(child.id);
        gone.add(child.id);
      }
    }
    throw new Error(
      `notion: page ${id} still has blocks after ${MAX_CLEAR_ROUNDS} rounds of deletes`,
    );
  }

  /** Appends blocks in requests of at most 100 blocks and 400 KB, in order. */
  async appendBlocks(id: string, blocks: unknown[]): Promise<void> {
    let batch: unknown[] = [];
    let size = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await this.call(
        "PATCH",
        `/blocks/${id}/children`,
        "/blocks/{id}/children",
        this.json({ children: batch }),
      );
      batch = [];
      size = 0;
    };
    for (const block of blocks) {
      const bytes = Buffer.byteLength(JSON.stringify(block));
      if (
        batch.length >= MAX_BATCH_BLOCKS ||
        (batch.length > 0 && size + bytes > MAX_BATCH_BYTES)
      ) {
        await flush();
      }
      batch.push(block);
      size += bytes;
    }
    await flush();
  }

  /** Pages of a database whose title property equals `title` exactly. */
  async findByTitle(databaseId: string, property: string, title: string): Promise<NotionPage[]> {
    const label = "/databases/{id}/query";
    const body = await this.call(
      "POST",
      `/databases/${databaseId}/query`,
      label,
      this.json({ filter: { property, title: { equals: title } }, page_size: 100 }),
    );
    const results = isObject(body) && Array.isArray(body["results"]) ? body["results"] : null;
    if (results === null) throw new Error(`notion: POST ${label} did not return a list`);
    return results.map((r) => asPage(r, `POST ${label}`));
  }

  /**
   * Uploads one file through the file upload API (create, then send) and returns the upload id an
   * image block attaches. The id expires an hour after the upload unless a block uses it. The send
   * URL is built from the validated id, not taken from the create response.
   */
  async uploadFile(fileName: string, data: Uint8Array, contentType: string): Promise<string> {
    const created = await this.call(
      "POST",
      "/file_uploads",
      "/file_uploads",
      this.json({ filename: fileName, content_type: contentType }),
    );
    const id = isObject(created) ? normalizeId(created["id"]) : null;
    if (id === null) throw new Error("notion: POST /file_uploads did not return a usable id");
    const form = new FormData();
    form.append("file", new Blob([data], { type: contentType }), fileName);
    await this.call(
      "POST",
      `/file_uploads/${id}/send`,
      "/file_uploads/{id}/send",
      { data: form },
      { timeoutMs: this.uploadTimeoutMs },
    );
    return id;
  }
}
