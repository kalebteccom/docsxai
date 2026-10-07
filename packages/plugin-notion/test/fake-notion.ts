// In-process fake Notion API (node:http, loopback) for the Notion publisher. It serves the calls the
// publisher makes (page create, read and update, block children list, append and delete, database
// query, file upload create and send), rejects any request that does not carry the expected bearer
// token and the pinned Notion-Version, enforces the documented limits on an append (100 blocks,
// 500 KB, 2000 characters per rich text item, 100 items per array, an image only from an uploaded
// file), and counts every write so tests can assert "second push of unchanged content: zero
// writes" against real HTTP traffic.

import { randomUUID } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakePage {
  id: string;
  parent: { type: "page_id" | "database_id"; id: string };
  title: string;
  archived: boolean;
  url: string;
}

export interface FakeBlock {
  id: string;
  parentId: string;
  type: string;
  archived: boolean;
  body: Record<string, unknown>;
}

export interface FakeUpload {
  id: string;
  filename: string;
  contentType: string;
  status: "pending" | "uploaded";
  data: Buffer | null;
  attached: boolean;
}

export interface FakeNotion {
  /** Pass as `base_url`. */
  baseUrl: string;
  /** The page the publisher publishes under, and the database it can publish into. */
  parentPageId: string;
  databaseId: string;
  /** Name of the database's title property. */
  titleProperty: string;
  pages: Map<string, FakePage>;
  blocks: Map<string, FakeBlock>;
  uploads: Map<string, FakeUpload>;
  /** POST, PATCH and DELETE requests that stored something. */
  writes: number;
  /** Request log, `METHOD /v1/path` with ids replaced by `{id}`, query stripped. */
  requests: string[];
  authHeaders: string[];
  versions: string[];
  /** Number of blocks of every accepted append, in order. */
  appendSizes: number[];
  /** Children returned per list page. */
  listPageSize: number;
  /** `METHOD /v1/path` -> number of 429 answers still to give. */
  rateLimited: Map<string, number>;
  /** `Retry-After` of a 429; null sends none. */
  retryAfter: string | null;
  /** When true, every request answers 500 with a body that echoes the token. */
  failEchoingSecrets: boolean;
  /** When set, every POST, PATCH and DELETE answers 307 with this `Location` and stores nothing. */
  redirectWritesTo: string | null;
  /** `METHOD /v1/path` entries that never get an answer, to exercise client timeouts. */
  stall: string[];
  /** `METHOD /v1/path` entries answered with a body over 8 MiB. */
  oversize: string[];
  /** Content blocks of a page or block, in order, trashed ones left out. */
  children(id: string): FakeBlock[];
  /** The one page with this title, for tests that publish a single page of that name. */
  pagesTitled(title: string): FakePage[];
  close(): Promise<void>;
}

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_UPLOAD = 20 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The first part of a multipart body: its file name, content type and bytes. */
function parseMultipart(
  body: Buffer,
  contentType: string,
): { filename: string; type: string; data: Buffer } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ""}`);
  const start = body.indexOf(marker) + marker.length;
  const headerEnd = body.indexOf("\r\n\r\n", start);
  const headers = body.subarray(start, headerEnd).toString("utf8");
  const end = body.indexOf(Buffer.concat([Buffer.from("\r\n"), marker]), headerEnd);
  return {
    filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? "",
    type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "",
    data: body.subarray(headerEnd + 4, end),
  };
}

type Json = Record<string, unknown>;

/** The first problem with an appended block, or null. */
function blockProblem(block: unknown, uploads: Map<string, FakeUpload>): string | null {
  if (typeof block !== "object" || block === null) return "block is not an object";
  const b = block as Json;
  const type = b["type"];
  if (
    typeof type !== "string" ||
    !/^(paragraph|heading_[123]|bulleted_list_item|numbered_list_item|code|image)$/.test(type)
  ) {
    return `unsupported block type ${String(type)}`;
  }
  const body = b[type] as Json | undefined;
  if (!body) return `block has no ${type} body`;
  if (type === "image") {
    const upload = uploads.get(String((body["file_upload"] as Json | undefined)?.["id"]));
    if (body["type"] !== "file_upload" || !upload) return "image does not name a file upload";
    if (upload.status !== "uploaded") return "image file upload was not sent";
    return null;
  }
  const rich = body["rich_text"];
  if (!Array.isArray(rich) || rich.length > 100) return "rich_text must hold at most 100 items";
  for (const item of rich as Json[]) {
    const content = (item["text"] as Json | undefined)?.["content"];
    if (typeof content !== "string" || content.length > 2000) return "rich text content too long";
  }
  if (type === "code" && typeof body["language"] !== "string") return "code needs a language";
  return null;
}

export async function startFakeNotion(
  token: string,
  opts: { titleProperty?: string } = {},
): Promise<FakeNotion> {
  const expectedAuth = `Bearer ${token}`;
  const state: FakeNotion = {
    baseUrl: "",
    parentPageId: randomUUID(),
    databaseId: randomUUID(),
    titleProperty: opts.titleProperty ?? "Name",
    pages: new Map(),
    blocks: new Map(),
    uploads: new Map(),
    writes: 0,
    requests: [],
    authHeaders: [],
    versions: [],
    appendSizes: [],
    listPageSize: 100,
    rateLimited: new Map(),
    retryAfter: "1",
    failEchoingSecrets: false,
    redirectWritesTo: null,
    stall: [],
    oversize: [],
    children: (id) => [...state.blocks.values()].filter((b) => b.parentId === id && !b.archived),
    pagesTitled: (title) => [...state.pages.values()].filter((p) => p.title === title),
    close: async () => {},
  };

  const pageJson = (p: FakePage): Json => ({
    object: "page",
    id: p.id,
    archived: p.archived,
    url: p.url,
    parent: { type: p.parent.type, [p.parent.type]: p.parent.id },
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      const sendJson = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      const fail = (status: number, code: string, message: string) =>
        sendJson(status, { object: "error", status, code, message });

      const auth = req.headers.authorization ?? "";
      state.authHeaders.push(auth);
      state.versions.push(String(req.headers["notion-version"] ?? ""));
      const url = new URL(req.url!, "http://localhost");
      const method = req.method ?? "GET";
      const route = `${method} ${url.pathname.replace(UUID_G, "{id}")}`;
      state.requests.push(route);
      const ids = url.pathname.match(UUID_G) ?? [];
      const id = ids[0]?.toLowerCase();
      const isWrite = method === "POST" || method === "PATCH" || method === "DELETE";

      if (state.failEchoingSecrets) {
        fail(500, "internal_server_error", `boom: credential ${auth} / ${token} rejected`);
        return;
      }
      if (auth !== expectedAuth) {
        req.resume();
        fail(401, "unauthorized", "API token is invalid.");
        return;
      }
      if (req.headers["notion-version"] !== "2022-06-28") {
        req.resume();
        fail(400, "invalid_request", "Notion-Version is missing or not supported by the fake.");
        return;
      }
      if (state.stall.includes(route)) {
        req.resume();
        return;
      }
      const limited = state.rateLimited.get(route) ?? 0;
      if (limited > 0) {
        state.rateLimited.set(route, limited - 1);
        req.resume();
        sendJson(
          429,
          { object: "error", status: 429, code: "rate_limited", message: "slow down" },
          state.retryAfter === null ? {} : { "retry-after": state.retryAfter },
        );
        return;
      }
      if (isWrite && state.redirectWritesTo) {
        req.resume();
        res.writeHead(307, { location: state.redirectWritesTo });
        res.end();
        return;
      }
      if (state.oversize.includes(route)) {
        req.resume();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(`{"object":"list","results":[]}${" ".repeat(8 * 1024 * 1024 + 1)}`);
        return;
      }

      const bodyBuffer = isWrite ? await readBody(req) : Buffer.alloc(0);
      if (!isWrite) req.resume();
      const isMultipart = String(req.headers["content-type"] ?? "").startsWith("multipart/");
      const body: Json =
        isWrite && !isMultipart && bodyBuffer.length > 0
          ? (JSON.parse(bodyBuffer.toString("utf8")) as Json)
          : {};

      const titleOf = (properties: unknown, key: string): string | null => {
        const prop = (properties as Json | undefined)?.[key] as Json | undefined;
        const first = (prop?.["title"] as Json[] | undefined)?.[0];
        const content = (first?.["text"] as Json | undefined)?.["content"];
        return typeof content === "string" ? content : null;
      };

      // Pages.
      if (method === "POST" && url.pathname === "/v1/pages") {
        const parent = body["parent"] as Json | undefined;
        const type = parent && "page_id" in parent ? "page_id" : "database_id";
        const parentId = String(parent?.[type] ?? "").toLowerCase();
        const known = type === "page_id" ? state.parentPageId : state.databaseId;
        if (parentId !== known) {
          fail(404, "object_not_found", "Could not find the parent.");
          return;
        }
        const title = titleOf(
          body["properties"],
          type === "page_id" ? "title" : state.titleProperty,
        );
        if (title === null) {
          fail(400, "validation_error", "The title property is missing or misnamed.");
          return;
        }
        state.writes++;
        const newId = randomUUID();
        const page: FakePage = {
          id: newId,
          parent: { type, id: parentId },
          title,
          archived: false,
          url: `https://www.notion.so/${title.replace(/[^A-Za-z0-9]+/g, "-")}-${newId.replaceAll("-", "")}`,
        };
        state.pages.set(newId, page);
        sendJson(200, pageJson(page));
        return;
      }
      const pageRoute = /^\/v1\/pages\/[0-9a-f-]{36}$/i.test(url.pathname);
      if (pageRoute && (method === "GET" || method === "PATCH")) {
        const page = state.pages.get(id!);
        if (!page) {
          fail(404, "object_not_found", "Could not find page.");
          return;
        }
        if (method === "PATCH") {
          const title = titleOf(
            body["properties"],
            page.parent.type === "page_id" ? "title" : state.titleProperty,
          );
          if (title === null) {
            fail(400, "validation_error", "The title property is missing or misnamed.");
            return;
          }
          state.writes++;
          page.title = title;
        }
        sendJson(200, pageJson(page));
        return;
      }

      // Block children.
      const childrenRoute = /^\/v1\/blocks\/[0-9a-f-]{36}\/children$/i.test(url.pathname);
      if (childrenRoute && method === "GET") {
        const nested = [...state.pages.values()]
          .filter((p) => p.parent.id === id && !p.archived)
          .map((p) => ({ id: p.id, type: "child_page", child_page: { title: p.title } }));
        const all = [
          ...nested,
          ...state.children(id!).map((b) => ({ id: b.id, type: b.type, [b.type]: b.body })),
        ];
        const from = Number(url.searchParams.get("start_cursor") ?? "0");
        const size = Math.min(
          Number(url.searchParams.get("page_size") ?? "100"),
          state.listPageSize,
        );
        const more = from + size < all.length;
        sendJson(200, {
          object: "list",
          results: all.slice(from, from + size),
          has_more: more,
          next_cursor: more ? String(from + size) : null,
        });
        return;
      }
      if (childrenRoute && method === "PATCH") {
        const children = body["children"];
        if (!state.pages.has(id!) && !state.blocks.has(id!)) {
          fail(404, "object_not_found", "Could not find block.");
          return;
        }
        if (!Array.isArray(children) || children.length > 100 || bodyBuffer.length > 500_000) {
          fail(400, "validation_error", "children must hold at most 100 blocks and 500 KB.");
          return;
        }
        for (const child of children) {
          const problem = blockProblem(child, state.uploads);
          if (problem) {
            fail(400, "validation_error", problem);
            return;
          }
        }
        state.writes++;
        state.appendSizes.push(children.length);
        const results: Json[] = [];
        for (const child of children as Json[]) {
          const type = child["type"] as string;
          const content = { ...(child[type] as Json) };
          for (const key of ["rich_text", "caption"]) {
            if (Array.isArray(content[key])) {
              content[key] = (content[key] as Json[]).map((item) => ({
                ...item,
                plain_text: (item["text"] as Json)["content"],
              }));
            }
          }
          if (type === "image") {
            state.uploads.get(String((content["file_upload"] as Json)["id"]))!.attached = true;
          }
          const block: FakeBlock = {
            id: randomUUID(),
            parentId: id!,
            type,
            archived: false,
            body: content,
          };
          state.blocks.set(block.id, block);
          results.push({ id: block.id, type, [type]: content });
        }
        sendJson(200, { object: "list", results, has_more: false, next_cursor: null });
        return;
      }
      if (method === "DELETE" && /^\/v1\/blocks\/[0-9a-f-]{36}$/i.test(url.pathname)) {
        const block = state.blocks.get(id!);
        const page = state.pages.get(id!);
        if (!block && !page) {
          fail(404, "object_not_found", "Could not find block.");
          return;
        }
        state.writes++;
        if (block) block.archived = true;
        if (page) page.archived = true;
        sendJson(200, { object: "block", id, archived: true });
        return;
      }

      // Database query.
      if (method === "POST" && /^\/v1\/databases\/[0-9a-f-]{36}\/query$/i.test(url.pathname)) {
        const filter = body["filter"] as Json | undefined;
        if (id !== state.databaseId || filter?.["property"] !== state.titleProperty) {
          fail(400, "validation_error", "Could not find the database or its title property.");
          return;
        }
        const equals = ((filter["title"] as Json | undefined)?.["equals"] ?? "") as string;
        const hits = [...state.pages.values()].filter(
          (p) => p.parent.id === id && !p.archived && p.title === equals,
        );
        sendJson(200, { object: "list", results: hits.map(pageJson), has_more: false });
        return;
      }

      // File uploads.
      if (method === "POST" && url.pathname === "/v1/file_uploads") {
        if (typeof body["filename"] !== "string" || typeof body["content_type"] !== "string") {
          fail(400, "validation_error", "filename and content_type are required.");
          return;
        }
        state.writes++;
        const upload: FakeUpload = {
          id: randomUUID(),
          filename: body["filename"],
          contentType: body["content_type"],
          status: "pending",
          data: null,
          attached: false,
        };
        state.uploads.set(upload.id, upload);
        sendJson(200, {
          object: "file_upload",
          id: upload.id,
          status: "pending",
          upload_url: `${state.baseUrl}/file_uploads/${upload.id}/send`,
        });
        return;
      }
      if (method === "POST" && /^\/v1\/file_uploads\/[0-9a-f-]{36}\/send$/i.test(url.pathname)) {
        const upload = state.uploads.get(id!);
        if (!upload || upload.status !== "pending") {
          fail(400, "validation_error", "The file upload does not accept contents.");
          return;
        }
        const part = parseMultipart(bodyBuffer, String(req.headers["content-type"] ?? ""));
        if (part.data.byteLength > MAX_UPLOAD) {
          fail(400, "validation_error", "File is over 20 MB.");
          return;
        }
        state.writes++;
        upload.data = part.data;
        upload.status = "uploaded";
        sendJson(200, { object: "file_upload", id: upload.id, status: "uploaded" });
        return;
      }

      fail(405, "invalid_request_url", `unsupported ${route}`);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  state.close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return state;
}
