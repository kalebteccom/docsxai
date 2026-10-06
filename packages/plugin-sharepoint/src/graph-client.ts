// Microsoft Graph transport for one SharePoint document library, `fetch` only.
//
// Two operations are enough for the publisher: read a file's content by path and upload a
// file by path (simple upload, `PUT .../root:/<path>:/content`). Graph creates missing parent
// folders on upload. The bearer token goes in the Authorization header and nowhere else; every
// error message passes through the `mask` callback before it leaves this module.

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

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface GraphUrlOptions {
  /** Accept `http:` on a loopback host. For tests that run a fake Graph server; never set in production. */
  allowLoopbackHttp?: boolean;
}

/**
 * Validate a `graph_base_url` and return it without trailing slashes. It must be `https:` on one
 * of {@link GRAPH_HOSTS} with no credentials; `http:` on a loopback host passes only under
 * `allowLoopbackHttp`. The bearer token is sent to whatever this accepts.
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
  return raw.replace(/\/+$/, "");
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

export class GraphClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly library: LibraryRef,
    private readonly token: string,
    private readonly mask: (s: string) => string,
    urlOptions: GraphUrlOptions = {},
  ) {
    // Checked again here so no caller can hand the token to another host.
    this.baseUrl = assertGraphBaseUrl(baseUrl, urlOptions);
  }

  private itemUrl(itemPath: string): string {
    const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/${this.library.root}/root:/${encoded}:/content`;
  }

  private async send(
    method: "GET" | "PUT",
    itemPath: string,
    body?: { data: Uint8Array; contentType: string },
  ): Promise<Response> {
    const query = method === "PUT" ? "?@microsoft.graph.conflictBehavior=replace" : "";
    try {
      return await fetch(`${this.itemUrl(itemPath)}${query}`, {
        method,
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body ? { "content-type": body.contentType } : {}),
        },
        ...(body ? { body: new Blob([body.data], { type: body.contentType }) } : {}),
      });
    } catch (e) {
      throw new Error(
        this.mask(`sharepoint: ${method} ${itemPath} failed: ${(e as Error).message}`),
      );
    }
  }

  private async fail(method: string, itemPath: string, res: Response): Promise<never> {
    const text = await readBoundedText(res, MAX_ERROR_BYTES, true);
    throw new Error(
      this.mask(
        `sharepoint: ${method} ${itemPath} returned HTTP ${res.status}: ${text.slice(0, 500)}`,
      ),
    );
  }

  /** File content as text (at most 8 MiB), or null when the item does not exist. */
  async readText(itemPath: string): Promise<string | null> {
    const res = await this.send("GET", itemPath);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail("GET", itemPath, res);
    return readBoundedText(res, MAX_MANIFEST_BYTES);
  }

  async upload(itemPath: string, data: Uint8Array, contentType: string): Promise<DriveItem> {
    const res = await this.send("PUT", itemPath, { data, contentType });
    if (!res.ok) return this.fail("PUT", itemPath, res);
    return JSON.parse(await readBoundedText(res, MAX_JSON_BYTES)) as DriveItem;
  }
}
