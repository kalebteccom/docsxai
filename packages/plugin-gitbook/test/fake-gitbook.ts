// In-process fake GitBook API (node:http, loopback) for the GitBook publisher. It serves the calls
// the publisher makes (page listing, page read, change request create, content batch, merge,
// archive), rejects any request without the expected bearer token, and counts every write so tests
// can assert "second push of unchanged content: zero writes" against real HTTP traffic. A content
// batch is atomic like the real one: a single invalid change rejects the whole batch.

import * as http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakePage {
  id: string;
  title: string;
  slug: string;
  parent: string | null;
  markdown: string;
  hidden: boolean;
  noIndex: boolean;
  version: number;
}

export interface FakeFile {
  id: string;
  name: string;
  contentType: string;
  data: Buffer;
}

export interface FakeChangeRequest {
  id: string;
  status: "open" | "merged" | "archived";
  subject: string;
  pages: Map<string, FakePage>;
  files: FakeFile[];
  /** Content batches applied to this change request. */
  batches: number;
}

export interface FakeGitBook {
  /** Pass as `base_url`. */
  baseUrl: string;
  /** The live content of the space. */
  pages: Map<string, FakePage>;
  files: FakeFile[];
  changeRequests: Map<string, FakeChangeRequest>;
  /** POST and PATCH requests that stored something: a change request, a content batch, a merge, an archive. */
  writes: number;
  /** Content batches accepted, across every change request. */
  batches: number;
  reads: number;
  /** Request log, `METHOD /path`, query stripped. */
  requests: string[];
  /** Authorization header of every request received. */
  authHeaders: string[];
  /** The `result` a merge answers with. */
  mergeResult: "merge" | "conflicts";
  /** The next this-many merges answer `conflicts` whatever `mergeResult` says. */
  conflictMerges: number;
  /** When true, every request answers 500 with a body that echoes the token. */
  failEchoingToken: boolean;
  /** When set, every POST and PATCH answers 307 with this `Location` and stores nothing. */
  redirectWritesTo: string | null;
  /** Limits `redirectWritesTo` to request paths that contain this text; empty matches every write. */
  redirectPathIncludes: string;
  /** `METHOD /path` entries that never get an answer, to exercise client timeouts. */
  stall: string[];
  /** When set, a POST to `.../content` answers 400 with this message and stores nothing. */
  rejectContent: string | null;
  /** The next this-many requests answer 429, with `retryAfter` as `Retry-After` when it is set. */
  throttle: number;
  retryAfter: string | null;
  /** When set, a change request is created under this id, whatever its shape. */
  changeRequestId: string | null;
  /** When set, the page listing answers with this many extra bytes of padding. */
  listPadding: number;
  /** Adds a page straight to the live content, as an editor in the GitBook app would. */
  seedPage(page: Partial<FakePage> & { title: string }): FakePage;
  close(): Promise<void>;
}

const SPACE = "space-1";

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function clonePages(pages: Map<string, FakePage>): Map<string, FakePage> {
  return new Map([...pages].map(([id, p]): [string, FakePage] => [id, { ...p }]));
}

interface FileChange {
  ref: string;
  name: string;
  contentType: string;
  base64: string;
}

interface Change {
  operation: string;
  files?: FileChange[];
  page?: string;
  title?: string;
  slug?: string;
  into?: string;
  hidden?: boolean;
  noIndex?: boolean;
  document?: { markdown?: string };
}

/** The title a frontmatter block sets, which wins over the `title` of a change like it does on GitBook. */
function frontmatterTitle(markdown: string): string | undefined {
  const m = /^---\ntitle: (".*")\n---\n/.exec(markdown);
  return m ? (JSON.parse(m[1]!) as string) : undefined;
}

export async function startFakeGitBook(token: string): Promise<FakeGitBook> {
  let nextPage = 1;
  let nextFile = 1;
  let nextRequest = 1;
  const state: FakeGitBook = {
    baseUrl: "",
    pages: new Map(),
    files: [],
    changeRequests: new Map(),
    writes: 0,
    batches: 0,
    reads: 0,
    requests: [],
    authHeaders: [],
    mergeResult: "merge",
    conflictMerges: 0,
    failEchoingToken: false,
    redirectWritesTo: null,
    redirectPathIncludes: "",
    stall: [],
    rejectContent: null,
    throttle: 0,
    retryAfter: null,
    changeRequestId: null,
    listPadding: 0,
    seedPage: (page) => {
      const id = page.id ?? `pg${nextPage++}`;
      const seeded: FakePage = {
        id,
        slug: id,
        parent: null,
        markdown: "",
        hidden: false,
        noIndex: false,
        version: 1,
        ...page,
      };
      state.pages.set(id, seeded);
      return seeded;
    },
    close: async () => {},
  };

  const tree = (parent: string | null): unknown[] =>
    [...state.pages.values()]
      .filter((p) => p.parent === parent)
      .map((p) => ({
        id: p.id,
        title: p.title,
        type: "document",
        slug: p.slug,
        path: p.slug,
        hidden: p.hidden,
        urls: { app: `https://app.gitbook.com/s/${SPACE}/${p.slug}` },
        pages: tree(p.id),
      }));

  /** Applies a batch to a draft copy; throws on the first invalid change, leaving the draft alone. */
  function applyBatch(cr: FakeChangeRequest, changes: Change[]): unknown[] {
    const pages = clonePages(cr.pages);
    const files = [...cr.files];
    const fileRefs = new Map<string, string>();
    const touched: unknown[] = [];
    for (const change of changes) {
      if (change.operation === "insert_files") {
        for (const f of change.files ?? []) {
          const file: FakeFile = {
            id: `file${nextFile++}`,
            name: f.name,
            contentType: f.contentType,
            data: Buffer.from(f.base64, "base64"),
          };
          files.push(file);
          fileRefs.set(f.ref, file.id);
        }
        continue;
      }
      const markdown = (change.document?.markdown ?? "").replace(
        /\]\(\.\/([A-Za-z0-9_-]+)\)/g,
        (whole, ref: string) => (fileRefs.has(ref) ? `](/files/${fileRefs.get(ref)})` : whole),
      );
      const title = frontmatterTitle(markdown) ?? change.title;
      if (change.operation === "insert_page") {
        if (change.into !== undefined && !pages.has(change.into)) throw new Error("unknown parent");
        const id = `pg${nextPage++}`;
        pages.set(id, {
          id,
          title: title ?? "Untitled",
          slug: change.slug ?? id,
          parent: change.into ?? null,
          markdown,
          hidden: change.hidden === true,
          noIndex: change.noIndex === true,
          version: 1,
        });
        touched.push({
          object: "created_page",
          page: { object: "page", id, urls: { location: `${state.baseUrl}/pages/${id}` } },
        });
      } else if (change.operation === "update_page") {
        const page = pages.get(change.page ?? "");
        if (!page) throw new Error("unknown page");
        page.title = title ?? page.title;
        page.markdown = markdown;
        page.version++;
        touched.push({
          object: "updated_page",
          page: {
            object: "page",
            id: page.id,
            urls: { location: `${state.baseUrl}/pages/${page.id}` },
          },
        });
      } else {
        throw new Error(`unsupported operation ${change.operation}`);
      }
    }
    cr.pages = pages;
    cr.files = files;
    cr.batches++;
    return touched;
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const sendJson = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const auth = req.headers.authorization ?? "";
      state.authHeaders.push(auth);
      const url = new URL(req.url!, "http://localhost");
      const key = `${req.method} ${url.pathname}`;
      state.requests.push(key);

      if (state.failEchoingToken) {
        req.resume();
        sendJson(500, {
          error: { code: 500, message: `boom: credential ${auth} / ${token} rejected` },
        });
        return;
      }
      if (auth !== `Bearer ${token}`) {
        req.resume();
        sendJson(401, { error: { code: 401, message: "unauthorized" } });
        return;
      }
      if (state.throttle > 0) {
        state.throttle--;
        req.resume();
        res.writeHead(429, {
          "content-type": "application/json",
          ...(state.retryAfter !== null ? { "retry-after": state.retryAfter } : {}),
        });
        res.end(JSON.stringify({ error: { code: 429, message: "slow down" } }));
        return;
      }
      if (state.stall.includes(key)) {
        req.resume();
        return;
      }
      if (
        (req.method === "POST" || req.method === "PATCH") &&
        state.redirectWritesTo &&
        url.pathname.includes(state.redirectPathIncludes)
      ) {
        req.resume();
        res.writeHead(307, { location: state.redirectWritesTo });
        res.end();
        return;
      }

      const p = url.pathname;
      const base = `/v1/spaces/${SPACE}`;
      if (req.method === "GET" && p === `${base}/content/pages`) {
        state.reads++;
        sendJson(200, { pages: tree(null), padding: " ".repeat(state.listPadding) });
        return;
      }
      const page = new RegExp(`^${base}/content/page/([^/]+)$`).exec(p);
      if (req.method === "GET" && page) {
        state.reads++;
        const found = state.pages.get(decodeURIComponent(page[1]!));
        if (!found) sendJson(404, { error: { code: 404, message: "not found" } });
        else sendJson(200, { id: found.id, title: found.title, markdown: found.markdown });
        return;
      }
      if (req.method === "POST" && p === `${base}/change-requests`) {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { subject?: string };
        state.writes++;
        const id = state.changeRequestId ?? `cr${nextRequest++}`;
        state.changeRequests.set(id, {
          id,
          status: "open",
          subject: body.subject ?? "",
          pages: clonePages(state.pages),
          files: [...state.files],
          batches: 0,
        });
        sendJson(201, { object: "change-request", id, status: "open" });
        return;
      }
      const cr = new RegExp(`^${base}/change-requests/([^/]+)(/content|/merge)?$`).exec(p);
      const draft = cr ? state.changeRequests.get(decodeURIComponent(cr[1]!)) : undefined;
      if (cr && !draft) {
        req.resume();
        sendJson(404, { error: { code: 404, message: "change request not found" } });
        return;
      }
      if (cr && draft && req.method === "POST" && cr[2] === "/content") {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { changes: Change[] };
        if (state.rejectContent !== null) {
          sendJson(400, { error: { code: 400, message: state.rejectContent } });
          return;
        }
        if (draft.status !== "open" || url.searchParams.get("compat") !== "false") {
          sendJson(400, { error: { code: 400, message: "change request is not open" } });
          return;
        }
        try {
          const touched = applyBatch(draft, body.changes);
          state.writes++;
          state.batches++;
          sendJson(200, { changeRequest: { id: draft.id }, changes: touched, insertedFiles: [] });
        } catch (e) {
          sendJson(400, { error: { code: 400, message: (e as Error).message } });
        }
        return;
      }
      if (cr && draft && req.method === "POST" && cr[2] === "/merge") {
        req.resume();
        if (draft.status !== "open") {
          sendJson(400, { error: { code: 400, message: "change request is not open" } });
          return;
        }
        state.writes++;
        draft.status = "merged";
        state.pages = clonePages(draft.pages);
        state.files = [...draft.files];
        const result = state.conflictMerges > 0 ? "conflicts" : state.mergeResult;
        if (state.conflictMerges > 0) state.conflictMerges--;
        sendJson(200, { revision: `rev-${draft.id}`, result });
        return;
      }
      if (cr && draft && req.method === "PATCH" && !cr[2]) {
        const body = JSON.parse((await readBody(req)).toString("utf8")) as { status?: string };
        if (body.status === "archived") {
          state.writes++;
          draft.status = "archived";
        }
        sendJson(200, { id: draft.id, status: draft.status });
        return;
      }

      req.resume();
      sendJson(405, { error: { code: 405, message: `unsupported ${req.method} ${p}` } });
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
