// Guru public API transport, `fetch` only.
//
// Five calls cover the publisher: search cards, read a card, create a card, update a card and
// upload an attachment. Basic auth (user email and user token) goes in the Authorization header
// and nowhere else; every error message passes through the `mask` callback before it leaves this
// module. Redirects are refused, so credentials never follow a Location header to another host.

export const DEFAULT_GURU_URL = "https://api.getguru.com/api/v1";
export const GURU_HOST = "api.getguru.com";
const GURU_PATH = "/api/v1";

/** Where Guru hosts uploaded files. Cards reference these URLs, the plugin never fetches them. */
export const ATTACHMENT_URL_PREFIX = "https://content.api.getguru.com/files/view/";

/** Largest JSON response read. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Largest error body read; only the first 500 characters reach a message. */
const MAX_ERROR_BYTES = 64 * 1024;
/** Search result pages followed for one lookup. */
export const MAX_SEARCH_PAGES = 5;

/** Ids Guru hands out are UUID-like; anything else is refused before it reaches a URL or a body. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface GuruUrlOptions {
  /** Accept `http:` on a loopback host. For tests that run a fake Guru server; never set in production. */
  allowLoopbackHttp?: boolean;
}

/**
 * Validate a `base_url` and return it without trailing slashes. It must be `https:` on
 * `api.getguru.com`, default port, path `/api/v1`, no credentials, query or fragment. `http:` on a
 * loopback host passes only under `allowLoopbackHttp`. The credentials are sent to whatever this
 * accepts.
 */
export function assertGuruBaseUrl(raw: string, options: GuruUrlOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("guru: config.base_url is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("guru: config.base_url must not contain credentials");
  }
  const loopback =
    options.allowLoopbackHttp === true &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (!loopback && !(url.protocol === "https:" && url.hostname === GURU_HOST)) {
    throw new Error(`guru: config.base_url must be https on ${GURU_HOST}`);
  }
  // `URL.port` is empty for the scheme's default port, so `:443` passes and any other port does not.
  if (!loopback && url.port !== "") {
    throw new Error("guru: config.base_url must use the default https port");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== GURU_PATH || url.search !== "" || url.hash !== "") {
    throw new Error(`guru: config.base_url path must be ${GURU_PATH}`);
  }
  return `${url.origin}${path}`;
}

/** `/files/view/<id>`: one id segment, no dots, slashes or escapes, so no traversal. */
const ATTACHMENT_PATH = /^\/files\/view\/[A-Za-z0-9_-]{1,128}$/;

/** True for a file URL on Guru's content host in that exact path shape, with no credentials, port or query. */
export function isAttachmentUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith(ATTACHMENT_URL_PREFIX)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "content.api.getguru.com" &&
      ATTACHMENT_PATH.test(url.pathname) &&
      !url.username &&
      !url.password &&
      url.port === "" &&
      url.search === "" &&
      url.hash === ""
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
    throw new Error(`guru: response body is over ${maxBytes} bytes`);
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
      if (!truncate) throw new Error(`guru: response body is over ${maxBytes} bytes`);
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface GuruCard {
  id: string;
  preferredPhrase?: string;
  content?: string;
  slug?: string;
  version?: number;
  shareStatus?: string;
  tags?: unknown[];
  collection?: { id?: string };
}

/** Body of a create or update. Guru requires `content` and `preferredPhrase` on both. */
export interface CardBody {
  preferredPhrase: string;
  content: string;
  shareStatus: string;
  collection: { id: string };
  /** An update without tags removes every tag on the card, so the publisher hands the existing ones back. */
  tags?: unknown[];
}

function asCard(value: unknown, what: string): GuruCard {
  const v = value as Record<string, unknown> | null;
  if (
    typeof v !== "object" ||
    v === null ||
    typeof v["id"] !== "string" ||
    !ID_PATTERN.test(v["id"])
  ) {
    throw new Error(`guru: ${what} did not return a card with a usable id`);
  }
  const collection = v["collection"] as { id?: unknown } | undefined;
  return {
    id: v["id"],
    ...(typeof v["preferredPhrase"] === "string" ? { preferredPhrase: v["preferredPhrase"] } : {}),
    ...(typeof v["content"] === "string" ? { content: v["content"] } : {}),
    ...(typeof v["slug"] === "string" ? { slug: v["slug"] } : {}),
    ...(typeof v["version"] === "number" ? { version: v["version"] } : {}),
    ...(typeof v["shareStatus"] === "string" ? { shareStatus: v["shareStatus"] } : {}),
    ...(Array.isArray(v["tags"]) ? { tags: v["tags"] } : {}),
    ...(typeof collection === "object" && collection !== null && typeof collection.id === "string"
      ? { collection: { id: collection.id } }
      : {}),
  };
}

/** The `next` target of a `Link` header, or null. */
function nextLink(header: string | null): string | null {
  for (const part of (header ?? "").split(/,(?=\s*<)/)) {
    const m = /^\s*<([^>]+)>\s*;\s*rel="?([^";]+)"?/.exec(part);
    if (m && /next/i.test(m[2]!)) return m[1]!;
  }
  return null;
}

export class GuruClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    baseUrl: string,
    email: string,
    token: string,
    private readonly mask: (s: string) => string,
    urlOptions: GuruUrlOptions = {},
  ) {
    // Checked again here so no caller can hand the credentials to another host.
    this.baseUrl = assertGuruBaseUrl(baseUrl, urlOptions);
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  private async send(
    method: "GET" | "POST" | "PUT",
    url: string,
    label: string,
    body?: { data: string | FormData; contentType?: string },
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method,
        redirect: "error",
        headers: {
          authorization: this.authHeader,
          accept: "application/json",
          ...(body?.contentType ? { "content-type": body.contentType } : {}),
        },
        ...(body ? { body: body.data } : {}),
      });
    } catch (e) {
      throw new Error(this.mask(`guru: ${method} ${label} failed: ${(e as Error).message}`));
    }
  }

  private async fail(method: string, label: string, res: Response): Promise<never> {
    const text = await readBoundedText(res, MAX_ERROR_BYTES, true);
    throw new Error(
      this.mask(`guru: ${method} ${label} returned HTTP ${res.status}: ${text.slice(0, 500)}`),
    );
  }

  private async parse(method: string, label: string, res: Response): Promise<unknown> {
    const text = await readBoundedText(res, MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(this.mask(`guru: ${method} ${label} returned a body that is not JSON`));
    }
  }

  /** The next search page URL, kept only when it stays on the validated origin and API path. */
  private sameApi(link: string): string | null {
    try {
      const url = new URL(link, `${this.baseUrl}/`);
      const base = new URL(this.baseUrl);
      return url.origin === base.origin && url.pathname.startsWith(`${GURU_PATH}/`)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  /** Cards matching free text, across up to {@link MAX_SEARCH_PAGES} pages of 50. */
  async searchCards(term: string): Promise<GuruCard[]> {
    const label = "/search/query";
    let url: string | null =
      `${this.baseUrl}${label}?searchTerms=${encodeURIComponent(term)}&maxResults=50`;
    const cards: GuruCard[] = [];
    for (let page = 0; url !== null && page < MAX_SEARCH_PAGES; page++) {
      const res = await this.send("GET", url, label);
      if (!res.ok) return this.fail("GET", label, res);
      const body = await this.parse("GET", label, res);
      if (!Array.isArray(body)) throw new Error("guru: GET /search/query did not return a list");
      for (const item of body) cards.push(asCard(item, "GET /search/query"));
      const next = nextLink(res.headers.get("link"));
      if (next === null) break;
      url = this.sameApi(next);
      if (url === null) throw new Error("guru: search returned a next page outside the Guru API");
    }
    return cards;
  }

  /** A card with its content, or null when it does not exist. */
  async getCard(id: string): Promise<GuruCard | null> {
    const label = "/cards/{id}/extended";
    const res = await this.send(
      "GET",
      `${this.baseUrl}/cards/${encodeURIComponent(id)}/extended`,
      label,
    );
    if (res.status === 404) return null;
    if (!res.ok) return this.fail("GET", label, res);
    return asCard(await this.parse("GET", label, res), `GET ${label}`);
  }

  async createCard(body: CardBody): Promise<GuruCard> {
    const label = "/cards/extended";
    const res = await this.send("POST", `${this.baseUrl}${label}`, label, {
      data: JSON.stringify(body),
      contentType: "application/json",
    });
    if (!res.ok) return this.fail("POST", label, res);
    return asCard(await this.parse("POST", label, res), `POST ${label}`);
  }

  async updateCard(id: string, body: CardBody): Promise<GuruCard> {
    const label = "/cards/{id}/extended";
    const res = await this.send(
      "PUT",
      `${this.baseUrl}/cards/${encodeURIComponent(id)}/extended`,
      label,
      { data: JSON.stringify(body), contentType: "application/json" },
    );
    if (!res.ok) return this.fail("PUT", label, res);
    return asCard(await this.parse("PUT", label, res), `PUT ${label}`);
  }

  /** Uploads one file and returns the Guru-hosted URL a card can embed. */
  async uploadAttachment(fileName: string, data: Uint8Array, contentType: string): Promise<string> {
    const label = "/attachments/upload";
    const form = new FormData();
    form.append("file", new Blob([data], { type: contentType }), fileName);
    const res = await this.send("POST", `${this.baseUrl}${label}`, label, { data: form });
    if (!res.ok) return this.fail("POST", label, res);
    const body = (await this.parse("POST", label, res)) as { link?: unknown } | null;
    const link = body?.link;
    if (!isAttachmentUrl(link)) {
      throw new Error(`guru: POST ${label} did not return a Guru file URL`);
    }
    return link;
  }
}
