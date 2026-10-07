// In-process fake Confluence Cloud server (node:http, loopback). Counts every mutation
// (page create/update, property write, attachment upload) so idempotency tests can assert
// "re-publish unchanged → ZERO mutations" against real HTTP traffic, not mocks.
//
// It models what Confluence Cloud really does with attachments: the v2 attachments resource
// is read-only (POST answers 405 METHOD_NOT_ALLOWED) and uploads go to the v1
// `child/attachment` resource, which needs `X-Atlassian-Token: no-check`, refuses a second
// attachment with the same file name (that is what `.../{id}/data` is for) and answers in the
// v1 shape (`results[0].extensions.fileId`).

import { createHash } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakePage {
  id: string;
  spaceId: string;
  parentId?: string;
  title: string;
  version: { number: number };
  bodyValue: string;
}

export interface FakeProperty {
  id: string;
  key: string;
  value: unknown;
  version: { number: number };
}

export interface FakeAttachment {
  id: string;
  title: string;
  comment: string;
  fileId: string;
  sha256: string;
}

export interface MutationCounts {
  pageCreates: number;
  pageUpdates: number;
  propertyWrites: number;
  attachmentUploads: number;
}

export interface FakeConfluence {
  baseUrl: string;
  counts: MutationCounts;
  /** Sum of all mutation counters. */
  totalMutations(): number;
  pages: Map<string, FakePage>;
  properties: Map<string, Map<string, FakeProperty>>;
  attachments: Map<string, Map<string, FakeAttachment>>;
  /** When true, every request 500s with a body that echoes the request's decoded API token. */
  failEchoingToken: boolean;
  /** When true, every v1 attachment upload answers 500 (the page itself is already created). */
  failAttachmentUploads: boolean;
  /** Count of POSTs to the read-only v2 attachments resource (each one got a 405). */
  v2UploadAttempts: number;
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

interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}

/** Minimal multipart/form-data parser — enough for the publisher's FormData uploads. */
function parseMultipart(body: Buffer, contentType: string): MultipartPart[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) throw new Error("multipart body without boundary");
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const parts: MultipartPart[] = [];
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const next = body.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    // Part = boundary CRLF headers CRLFCRLF data CRLF (before next boundary)
    const segment = body.subarray(pos + boundary.length + 2, next - 2);
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = segment.subarray(0, headerEnd).toString("utf8");
      const data = segment.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/.exec(headers);
      const fileMatch = /filename="([^"]+)"/.exec(headers);
      if (nameMatch) {
        parts.push({
          name: nameMatch[1]!,
          ...(fileMatch ? { filename: fileMatch[1]! } : {}),
          data: Buffer.from(data),
        });
      }
    }
    pos = next;
  }
  return parts;
}

export async function startFakeConfluence(): Promise<FakeConfluence> {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const pages = new Map<string, FakePage>();
  const properties = new Map<string, Map<string, FakeProperty>>();
  const attachments = new Map<string, Map<string, FakeAttachment>>();
  const counts: MutationCounts = {
    pageCreates: 0,
    pageUpdates: 0,
    propertyWrites: 0,
    attachmentUploads: 0,
  };

  const state: FakeConfluence = {
    baseUrl: "",
    counts,
    totalMutations: () =>
      counts.pageCreates + counts.pageUpdates + counts.propertyWrites + counts.attachmentUploads,
    pages,
    properties,
    attachments,
    failEchoingToken: false,
    failAttachmentUploads: false,
    v2UploadAttempts: 0,
    close: async () => {},
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const sendJson = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (state.failEchoingToken) {
        // Decode the Basic auth header and echo the raw token back — simulates a sloppy
        // upstream error body so tests can prove the publisher masks it.
        const auth = req.headers.authorization ?? "";
        const decoded = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString("utf8");
        const token = decoded.split(":").slice(1).join(":");
        sendJson(500, { message: `boom: credential ${token} rejected by upstream` });
        return;
      }

      if (!req.headers.authorization?.startsWith("Basic ")) {
        sendJson(401, { message: "missing basic auth" });
        return;
      }

      const url = new URL(req.url!, "http://localhost");
      const body = await readBody(req);
      const segments = url.pathname.split("/").filter(Boolean); // wiki api v2 pages ...

      // POST /wiki/api/v2/pages
      if (req.method === "POST" && url.pathname === "/wiki/api/v2/pages") {
        const parsed = JSON.parse(body.toString("utf8")) as {
          spaceId: string;
          title: string;
          parentId?: string;
          body: { value: string };
        };
        const page: FakePage = {
          id: id("page"),
          spaceId: parsed.spaceId,
          ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
          title: parsed.title,
          version: { number: 1 },
          bodyValue: parsed.body.value,
        };
        pages.set(page.id, page);
        counts.pageCreates++;
        sendJson(200, { id: page.id, title: page.title, version: page.version });
        return;
      }

      // v1 attachment upload: POST /wiki/rest/api/content/:pageId/child/attachment[/:attId/data]
      if (
        req.method === "POST" &&
        segments[0] === "wiki" &&
        segments[1] === "rest" &&
        segments[2] === "api" &&
        segments[3] === "content" &&
        segments[5] === "child" &&
        segments[6] === "attachment" &&
        (segments.length === 7 || (segments.length === 9 && segments[8] === "data"))
      ) {
        const pageId = segments[4]!;
        if (!pages.has(pageId)) {
          sendJson(404, { message: `no page ${pageId}` });
          return;
        }
        if (req.headers["x-atlassian-token"] !== "no-check") {
          sendJson(403, { message: "XSRF check failed" });
          return;
        }
        if (state.failAttachmentUploads) {
          sendJson(500, { message: "attachment storage unavailable" });
          return;
        }
        const atts = attachments.get(pageId) ?? new Map<string, FakeAttachment>();
        attachments.set(pageId, atts);
        const parts = parseMultipart(body, req.headers["content-type"] ?? "");
        const file = parts.find((p) => p.name === "file");
        const comment = parts.find((p) => p.name === "comment")?.data.toString("utf8") ?? "";
        if (!file?.filename) {
          sendJson(400, { message: "attachment upload without a file part" });
          return;
        }
        const existing = atts.get(file.filename);
        const isUpdate = segments.length === 9;
        if (isUpdate && existing?.id !== segments[7]) {
          sendJson(404, { message: `no attachment ${segments[7]}` });
          return;
        }
        if (!isUpdate && existing) {
          sendJson(400, {
            message: `Cannot add a new attachment with same file name as an existing attachment: ${file.filename}`,
          });
          return;
        }
        const att: FakeAttachment = {
          id: existing?.id ?? id("att"),
          title: file.filename,
          comment,
          fileId: id("file"),
          sha256: createHash("sha256").update(file.data).digest("hex"),
        };
        atts.set(att.title, att);
        counts.attachmentUploads++;
        const content = {
          id: att.id,
          type: "attachment",
          title: att.title,
          extensions: {
            mediaType: "image/png",
            fileSize: file.data.length,
            comment: att.comment,
            fileId: att.fileId,
          },
        };
        // The create endpoint wraps the content in `results`; the `/data` update returns it bare.
        sendJson(200, isUpdate ? content : { results: [content], size: 1 });
        return;
      }

      // /wiki/api/v2/pages/:id[...]
      if (
        segments[0] === "wiki" &&
        segments[1] === "api" &&
        segments[2] === "v2" &&
        segments[3] === "pages"
      ) {
        const pageId = segments[4];
        const page = pageId ? pages.get(pageId) : undefined;
        if (!page) {
          sendJson(404, { message: `no page ${pageId}` });
          return;
        }
        const rest = segments.slice(5);

        if (rest.length === 0 && req.method === "GET") {
          sendJson(200, { id: page.id, title: page.title, version: page.version });
          return;
        }

        if (rest.length === 0 && req.method === "PUT") {
          const parsed = JSON.parse(body.toString("utf8")) as {
            title: string;
            version: { number: number };
            body: { value: string };
          };
          if (parsed.version.number !== page.version.number + 1) {
            sendJson(409, {
              message: `version conflict: have ${page.version.number}, got ${parsed.version.number}`,
            });
            return;
          }
          page.title = parsed.title;
          page.version = { number: parsed.version.number };
          page.bodyValue = parsed.body.value;
          counts.pageUpdates++;
          sendJson(200, { id: page.id, title: page.title, version: page.version });
          return;
        }

        if (rest[0] === "properties") {
          const props = properties.get(page.id) ?? new Map<string, FakeProperty>();
          properties.set(page.id, props);

          if (req.method === "GET") {
            const key = url.searchParams.get("key");
            const results = [...props.values()].filter((p) => !key || p.key === key);
            sendJson(200, { results });
            return;
          }
          if (req.method === "POST") {
            const parsed = JSON.parse(body.toString("utf8")) as { key: string; value: unknown };
            const prop: FakeProperty = {
              id: id("prop"),
              key: parsed.key,
              value: parsed.value,
              version: { number: 1 },
            };
            props.set(prop.id, prop);
            counts.propertyWrites++;
            sendJson(200, prop);
            return;
          }
          if (req.method === "PUT" && rest[1]) {
            const prop = props.get(rest[1]);
            if (!prop) {
              sendJson(404, { message: `no property ${rest[1]}` });
              return;
            }
            const parsed = JSON.parse(body.toString("utf8")) as {
              value: unknown;
              version: { number: number };
            };
            prop.value = parsed.value;
            prop.version = { number: parsed.version.number };
            counts.propertyWrites++;
            sendJson(200, prop);
            return;
          }
        }

        if (rest[0] === "attachments") {
          const atts = attachments.get(page.id) ?? new Map<string, FakeAttachment>();
          attachments.set(page.id, atts);

          if (req.method === "GET") {
            sendJson(200, { results: [...atts.values()] });
            return;
          }
          if (req.method === "POST") {
            state.v2UploadAttempts++;
            sendJson(405, {
              code: 405,
              reason: "METHOD_NOT_ALLOWED",
              message: "Method Not Allowed",
            });
            return;
          }
        }
      }

      sendJson(404, { message: `unhandled ${req.method} ${url.pathname}` });
    })().catch((e: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: (e as Error).message }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  state.baseUrl = `http://127.0.0.1:${port}`;
  state.close = () =>
    new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return state;
}
