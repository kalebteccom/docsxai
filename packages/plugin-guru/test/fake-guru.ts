// In-process fake Guru API (node:http, loopback) for the Guru publisher. It serves the calls the
// publisher makes (card search, read, create, update, attachment upload), rejects any request
// that does not carry the expected Basic credentials, and counts every write so tests can assert
// "second push of unchanged content: zero writes" against real HTTP traffic. Like the real API, an
// update without `tags` removes the card's tags.

import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeCard {
  id: string;
  preferredPhrase: string;
  content: string;
  slug: string;
  version: number;
  shareStatus: string;
  collection: { id: string };
  tags: unknown[];
}

export interface FakeUpload {
  filename: string;
  data: Buffer;
  link: string;
}

export interface FakeGuru {
  /** Pass as `base_url`. */
  baseUrl: string;
  cards: Map<string, FakeCard>;
  uploads: FakeUpload[];
  /** POST and PUT requests that stored something. */
  writes: number;
  reads: number;
  /** Request log, `METHOD /path`, query stripped. */
  requests: string[];
  /** Authorization header of every request received. */
  authHeaders: string[];
  /** Cards per search page; a `Link: rel="next-page"` header points at the rest. */
  searchPageSize: number;
  /** When set, the search `Link` header points here instead of at this server. */
  searchLinkOverride: string | null;
  /** When true, every request answers 500 with a body that echoes the credentials. */
  failEchoingSecrets: boolean;
  /** When set, every POST and PUT answers 307 with this `Location` and stores nothing. */
  redirectWritesTo: string | null;
  /** `METHOD /path` entries that never get an answer, to exercise client timeouts. */
  stall: string[];
  /** When set, the upload response carries this `link` instead of a Guru file URL. */
  uploadLink: string | null;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The first part of a multipart body: its file name and bytes. */
function parseMultipart(body: Buffer, contentType: string): { filename: string; data: Buffer } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ""}`);
  const start = body.indexOf(marker) + marker.length;
  const headerEnd = body.indexOf("\r\n\r\n", start);
  const headers = body.subarray(start, headerEnd).toString("utf8");
  const end = body.indexOf(Buffer.concat([Buffer.from("\r\n"), marker]), headerEnd);
  return {
    filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? "",
    data: body.subarray(headerEnd + 4, end),
  };
}

export async function startFakeGuru(email: string, token: string): Promise<FakeGuru> {
  const expectedAuth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  let nextCard = 1;
  let nextUpload = 1;
  const state: FakeGuru = {
    baseUrl: "",
    cards: new Map(),
    uploads: [],
    writes: 0,
    reads: 0,
    requests: [],
    authHeaders: [],
    searchPageSize: 50,
    searchLinkOverride: null,
    failEchoingSecrets: false,
    redirectWritesTo: null,
    uploadLink: null,
    stall: [],
    close: async () => {},
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const sendJson = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      const auth = req.headers.authorization ?? "";
      state.authHeaders.push(auth);
      const url = new URL(req.url!, "http://localhost");
      state.requests.push(`${req.method} ${url.pathname}`);

      if (state.failEchoingSecrets) {
        sendJson(500, { message: `boom: credential ${auth} / ${email} / ${token} rejected` });
        return;
      }
      if (auth !== expectedAuth) {
        sendJson(401, { message: "unauthorized" });
        return;
      }
      if (state.stall.includes(`${req.method} ${url.pathname}`)) {
        req.resume();
        return;
      }
      if ((req.method === "POST" || req.method === "PUT") && state.redirectWritesTo) {
        req.resume();
        res.writeHead(307, { location: state.redirectWritesTo });
        res.end();
        return;
      }

      const p = url.pathname;
      if (req.method === "GET" && p === "/api/v1/search/query") {
        state.reads++;
        const term = (url.searchParams.get("searchTerms") ?? "").toLowerCase();
        const hits = [...state.cards.values()].filter((c) =>
          c.preferredPhrase.toLowerCase().includes(term),
        );
        const page = Number(url.searchParams.get("page") ?? "0");
        const slice = hits.slice(page * state.searchPageSize, (page + 1) * state.searchPageSize);
        const more = (page + 1) * state.searchPageSize < hits.length;
        const next = `${state.searchLinkOverride ?? `${state.baseUrl}/search/query`}?searchTerms=${encodeURIComponent(term)}&page=${page + 1}`;
        sendJson(200, slice, more ? { link: `<${next}>; rel="next-page"` } : {});
        return;
      }

      if (req.method === "POST" && p === "/api/v1/attachments/upload") {
        const { filename, data } = parseMultipart(
          await readBody(req),
          String(req.headers["content-type"] ?? ""),
        );
        state.writes++;
        const link =
          state.uploadLink ??
          `https://content.api.getguru.com/files/view/00000000-0000-4000-8000-${String(nextUpload++).padStart(12, "0")}`;
        state.uploads.push({ filename, data, link });
        sendJson(200, { link, filename, size: data.byteLength, mimeType: "image/png" });
        return;
      }

      if (req.method === "POST" && p === "/api/v1/cards/extended") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as Partial<FakeCard>;
        if (!body.content || !body.preferredPhrase) {
          sendJson(400, { message: "Content and title are required" });
          return;
        }
        state.writes++;
        const id = `card-${nextCard++}`;
        const card: FakeCard = {
          id,
          preferredPhrase: body.preferredPhrase,
          content: body.content,
          slug: `slug${id}/${body.preferredPhrase.replace(/[^A-Za-z0-9]+/g, "-")}`,
          version: 1,
          shareStatus: body.shareStatus ?? "PRIVATE",
          collection: { id: body.collection?.id ?? "" },
          tags: body.tags ?? [],
        };
        state.cards.set(id, card);
        sendJson(200, card);
        return;
      }

      const match = /^\/api\/v1\/cards\/([^/]+)\/extended$/.exec(p);
      if (match && (req.method === "GET" || req.method === "PUT")) {
        const card = state.cards.get(decodeURIComponent(match[1]!));
        if (!card) {
          req.resume();
          sendJson(404, { message: "not found" });
          return;
        }
        if (req.method === "GET") {
          state.reads++;
          sendJson(200, card);
          return;
        }
        const body = JSON.parse((await readBody(req)).toString("utf8")) as Partial<FakeCard>;
        if (!body.content || !body.preferredPhrase) {
          sendJson(400, { message: "Content and title are required" });
          return;
        }
        state.writes++;
        card.preferredPhrase = body.preferredPhrase;
        card.content = body.content;
        card.shareStatus = body.shareStatus ?? "PRIVATE";
        card.tags = body.tags ?? [];
        card.version++;
        sendJson(200, card);
        return;
      }

      sendJson(405, { message: `unsupported ${req.method} ${p}` });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  state.close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return state;
}
