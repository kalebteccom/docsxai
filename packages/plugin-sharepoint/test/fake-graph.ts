// In-process fake Microsoft Graph (node:http, loopback) for the SharePoint publisher. It serves
// the two path-addressed driveItem calls the publisher makes, rejects any request that does not
// carry the expected bearer token, and counts every write so tests can assert "second push of
// unchanged content: zero writes" against real HTTP traffic. Like real Graph, a GET of a file's
// content answers with a redirect to a pre-authenticated download URL (served here under
// `/download/`, with no authorization check), and a test can point that redirect elsewhere.

import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeFile {
  data: Buffer;
  contentType: string;
  id: string;
}

export interface FakeGraph {
  /** Pass as `graph_base_url`. */
  baseUrl: string;
  /** Library-relative path (`docsxai/index.md`) to the stored file. */
  files: Map<string, FakeFile>;
  writes: number;
  reads: number;
  /** Authorization header of every request received. */
  authHeaders: string[];
  /** When true, every request answers 500 with a body that echoes the bearer token. */
  failEchoingToken: boolean;
  /** Characters of filler before the echoed token, to place it across the 500-character cut. */
  errorPadding: number;
  /** When set, every PUT answers 307 with this `Location` instead of storing the file. */
  redirectWritesTo: string | null;
  /** When true (the default), a GET of a file answers 302 to `/download/<path>` on this server, as Graph does. */
  redirectReadsToDownload: boolean;
  /** When set, a GET of a file answers 302 with this `Location` instead (a hostile or odd target). */
  redirectReadsTo: string | null;
  /** When set, `/download/...` itself answers 302 with this `Location`. */
  downloadRedirectsTo: string | null;
  /** Authorization header of every download request (empty string when none was sent). */
  downloadAuthHeaders: string[];
  /** `METHOD library-relative-path` entries that never get an answer, to exercise timeouts. */
  stall: string[];
  /** `METHOD library-relative-path` entries answered 200 with a body that never finishes. */
  stallBody: string[];
  close(): Promise<void>;
}

// /v1.0/drives/<id>/root:/<path>:/content  or  /v1.0/sites/<id>/drive/root:/<path>:/content
const ITEM = /^\/v1\.0\/(?:drives\/[^/]+|sites\/[^/]+\/drive)\/root:\/(.+):\/content$/;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startFakeGraph(expectedToken: string): Promise<FakeGraph> {
  let nextId = 1;
  const state: FakeGraph = {
    baseUrl: "",
    files: new Map(),
    writes: 0,
    reads: 0,
    authHeaders: [],
    failEchoingToken: false,
    errorPadding: 0,
    redirectWritesTo: null,
    redirectReadsToDownload: true,
    redirectReadsTo: null,
    downloadRedirectsTo: null,
    downloadAuthHeaders: [],
    stall: [],
    stallBody: [],
    close: async () => {},
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const sendJson = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const url = new URL(req.url!, "http://localhost");
      const DOWNLOAD = "/download/";
      if (url.pathname.startsWith(DOWNLOAD)) {
        // A pre-authenticated URL: no bearer token expected, and the test can see whether one came.
        state.downloadAuthHeaders.push(req.headers.authorization ?? "");
        if (state.downloadRedirectsTo) {
          res.writeHead(302, { location: state.downloadRedirectsTo });
          res.end();
          return;
        }
        const file = state.files.get(decodeURIComponent(url.pathname.slice(DOWNLOAD.length)));
        if (!file) {
          sendJson(404, { error: { code: "itemNotFound" } });
          return;
        }
        res.writeHead(200, { "content-type": file.contentType });
        res.end(file.data);
        return;
      }
      const auth = req.headers.authorization ?? "";
      state.authHeaders.push(auth);

      if (state.failEchoingToken) {
        sendJson(500, {
          error: {
            message: `${"x".repeat(state.errorPadding)}boom: credential ${auth.slice(7)} rejected`,
          },
        });
        return;
      }
      if (auth !== `Bearer ${expectedToken}`) {
        sendJson(401, { error: { code: "InvalidAuthenticationToken" } });
        return;
      }

      const match = ITEM.exec(url.pathname);
      if (!match) {
        sendJson(400, { error: { code: "badRequest", message: `unsupported ${url.pathname}` } });
        return;
      }
      const itemPath = match[1]!.split("/").map(decodeURIComponent).join("/");

      if (state.stall.includes(`${req.method} ${itemPath}`)) {
        req.resume();
        return;
      }
      if (state.stallBody.includes(`${req.method} ${itemPath}`)) {
        res.writeHead(200, { "content-type": "application/json", "content-length": "1000000" });
        res.write("{");
        return;
      }

      if (req.method === "GET") {
        state.reads++;
        const file = state.files.get(itemPath);
        if (!file) {
          sendJson(404, { error: { code: "itemNotFound" } });
          return;
        }
        if (state.redirectReadsTo || state.redirectReadsToDownload) {
          const origin = new URL(state.baseUrl).origin;
          const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
          res.writeHead(302, {
            location: state.redirectReadsTo ?? `${origin}${DOWNLOAD}${encoded}`,
          });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": file.contentType });
        res.end(file.data);
        return;
      }

      if (req.method === "PUT" && state.redirectWritesTo) {
        req.resume();
        res.writeHead(307, { location: state.redirectWritesTo });
        res.end();
        return;
      }

      if (req.method === "PUT") {
        const data = await readBody(req);
        state.writes++;
        const prior = state.files.get(itemPath);
        const file: FakeFile = {
          data,
          contentType: String(req.headers["content-type"] ?? ""),
          id: prior?.id ?? `item-${nextId++}`,
        };
        state.files.set(itemPath, file);
        sendJson(prior ? 200 : 201, {
          id: file.id,
          name: itemPath.split("/").pop(),
          size: data.byteLength,
          webUrl: `https://contoso.sharepoint.com/sites/docs/Shared%20Documents/${itemPath}`,
        });
        return;
      }

      sendJson(405, { error: { code: "methodNotAllowed" } });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1.0`;
  state.close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return state;
}
