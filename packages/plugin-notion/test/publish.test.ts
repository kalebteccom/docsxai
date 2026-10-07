// Publisher suite against the in-process fake Notion server: idempotent re-push (zero writes),
// in-place page rewrites, images attached through the file upload API, the token absent from every
// log line and error, the exact capability declaration, the base URL allowlist, redirect refusal on
// writes, 429 retries, bounded responses, workspace-confined attachment reads, and the load
// through the real plugin runtime.

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdfDoc,
  type AdfNode,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  markdownToAdf,
  projectDocPackToAdf,
  resolvePlugins,
} from "@docsxai/engine";
import { parseConfig } from "../src/config.js";
import {
  MANIFEST_SCHEMA,
  MANIFEST_TITLE,
  type Manifest,
  emptyManifest,
  manifestBlocks,
  parseManifestText,
} from "../src/manifest.js";
import {
  type NotionBlock,
  adfToBlocks,
  codeBlocks,
  safeName,
  splitText,
} from "../src/notion-blocks.js";
import {
  MAX_RESPONSE_BYTES,
  NotionClient,
  assertNotionBaseUrl,
  isNotionUrl,
  normalizeId,
  readBoundedText,
} from "../src/notion-client.js";
import {
  MAX_UPLOAD_BYTES,
  type NotionPublisherOptions,
  createNotionPublisher,
} from "../src/publisher.js";
import { MAX_IMAGE_BYTES } from "../src/read-file.js";
import { type FakeNotion, type FakePage, startFakeNotion } from "./fake-notion.js";

/** The fake Notion server is plain http on loopback, which the publisher refuses unless told otherwise. */
const LOOPBACK = { allowLoopbackHttp: true, minIntervalMs: 0, sleep: async () => {} } as const;

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "notiontok-9f8e7d6c-5b4a-4321-abcd-0123456789ab";

const tempDirs: string[] = [];
let server: FakeNotion;

beforeAll(() => {
  process.env["NOTION_TOKEN"] = TOKEN;
});
afterAll(async () => {
  delete process.env["NOTION_TOKEN"];
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});
beforeEach(async () => {
  server = await startFakeNotion(TOKEN);
});
afterEach(async () => {
  await server.close();
});

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

/** Two flows, one documented step each: enough for both modes and for image upload. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-notion-test-"));
  tempDirs.push(dir);
  for (const [flow, png] of [
    ["checkout", PNG_A],
    ["login", PNG_B],
  ] as const) {
    await fs.mkdir(path.join(dir, "flows"), { recursive: true });
    await fs.mkdir(path.join(dir, "docs", flow, "burned"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "flows", `${flow}.flow.yaml`),
      `name: ${flow}\nsteps:\n  - id: step-1\n    action: navigate\n    value: /${flow}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(dir, "docs", flow, "step-1.md"), `Go to **${flow}**.\n`, "utf8");
    await fs.writeFile(path.join(dir, "docs", flow, "burned", "step-1.png"), png);
  }
  return dir;
}

interface Captured {
  log: PluginLogger;
  lines: string[];
}

function capture(): Captured {
  const lines: string[] = [];
  const push = (m: string) => lines.push(m);
  return { log: { info: push, warn: push, error: push }, lines };
}

function makeCtx(
  workspaceDir: string,
  projection: AdfProjection,
  log: PluginLogger,
  extraConfig: Record<string, unknown> = {},
): PublisherContext {
  return {
    workspaceDir,
    projection,
    artifactsDir: workspaceDir,
    config: { parent_page_id: server.parentPageId, base_url: server.baseUrl, ...extraConfig },
    secretsEnv: { token: "NOTION_TOKEN" },
    log,
  };
}

/** A projection built by hand, for tests that control the exact ADF. */
function handProjection(content: AdfNode[], title = "Hand made"): AdfProjection {
  return {
    schema: "docsxai/adf-projection@1",
    mode: "single",
    warnings: [],
    documents: [
      { section: "project", title, adf: { version: 1, type: "doc", content }, attachments: [] },
    ],
  };
}

const PAGE_TREE = { mode: "page-tree" as const, title: "Shop docs" };

function richPlain(items: unknown): string {
  return (Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [])
    .map((i) => String(i["plain_text"] ?? ""))
    .join("");
}

/** The text of every block of a page, one entry per block. */
function blockTexts(pageId: string): string[] {
  return server.children(pageId).map((b) => richPlain(b.body["rich_text"]));
}

function manifestPage(): FakePage {
  const found = server.pagesTitled(MANIFEST_TITLE);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function manifestText(pageId: string): string {
  return server
    .children(pageId)
    .filter((b) => b.type === "code")
    .map((b) => richPlain(b.body["rich_text"]))
    .join("");
}

function readManifest(): Manifest {
  return parseManifestText(manifestText(manifestPage().id), () => {}, "test");
}

/** Puts blocks straight into the fake, as an earlier push would have left them. */
function seedBlocks(pageId: string, blocks: NotionBlock[]): void {
  for (const b of blocks) {
    const type = b["type"] as string;
    const body = { ...(b[type] as Record<string, unknown>) };
    if (Array.isArray(body["rich_text"])) {
      body["rich_text"] = (body["rich_text"] as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        plain_text: (item["text"] as Record<string, unknown>)["content"],
      }));
    }
    const id = randomUUID();
    server.blocks.set(id, { id, parentId: pageId, type, archived: false, body });
  }
}

function seedPage(title: string, parentId = server.parentPageId): FakePage {
  const id = randomUUID();
  const page: FakePage = {
    id,
    parent: { type: "page_id", id: parentId },
    title,
    archived: false,
    url: `https://www.notion.so/${id.replaceAll("-", "")}`,
  };
  server.pages.set(id, page);
  return page;
}

/** A manifest page holding `text`, with the parent, the id and the title a push would leave. */
function seedManifest(text: string, parentId = server.parentPageId): FakePage {
  const page = seedPage(MANIFEST_TITLE, parentId);
  seedBlocks(page.id, codeBlocks(text));
  return page;
}

function setManifestText(text: string): void {
  const page = manifestPage();
  for (const b of server.children(page.id)) b.archived = true;
  seedBlocks(page.id, codeBlocks(text));
}

const publishWith = async (
  dir: string,
  projection: AdfProjection,
  extra: Record<string, unknown> = {},
  options: Partial<NotionPublisherOptions> = {},
) =>
  createNotionPublisher({ ...LOOPBACK, ...options }).publish(
    makeCtx(dir, projection, capture().log, extra),
  );

describe("notion publisher: idempotency (fake Notion)", () => {
  it("pushes a single-mode pack twice: the second push performs zero writes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createNotionPublisher(LOOPBACK);
    const { log } = capture();

    const run1 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run1.ok).toBe(true);
    expect(run1.target).toBe(`notion:page/${server.parentPageId}`);
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([["project", "created"]]);
    expect(run1.pages[0]!.url).toMatch(/^https:\/\/www\.notion\.so\//);
    // 1 page, 2 images (create + send each), 1 append, then the manifest page and its 1 append.
    expect(server.writes).toBe(8);
    expect(server.pages.size).toBe(2);
    expect(server.uploads.size).toBe(2);

    const writesAfterRun1 = server.writes;
    server.requests.length = 0;
    const run2 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(run2.pages[0]!.url).toBe(run1.pages[0]!.url);
    expect(server.writes).toBe(writesAfterRun1);
    expect(server.requests.filter((r) => /^(POST|PATCH|DELETE) /.test(r))).toEqual([]);
    expect(server.pages.size).toBe(2);
  });

  it("rewrites the same page in place, and a repeat of the changed push writes nothing", async () => {
    const dir = await makeWorkspace();
    const first = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run1 = await publishWith(dir, first, { title_prefix: "[Docs] " });
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "created"],
      ["checkout", "created"],
      ["login", "created"],
    ]);
    expect(server.pagesTitled("[Docs] Shop docs")).toHaveLength(1);
    // 3 pages, 2 images (2 writes each), 3 appends, the manifest page and its append.
    expect(server.writes).toBe(12);
    expect(server.pages.size).toBe(4);
    const checkoutId = run1.pages[1]!.id;
    const oldBlocks = server.children(checkoutId).length;
    const baseline = server.writes;

    await fs.writeFile(
      path.join(dir, "docs", "checkout", "step-1.md"),
      "Go to **checkout** with new copy.\n",
      "utf8",
    );
    const second = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run2 = await publishWith(dir, second, { title_prefix: "[Docs] " });
    expect(run2.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "unchanged"],
      ["checkout", "updated"],
      ["login", "unchanged"],
    ]);
    expect(run2.pages[1]!.id).toBe(checkoutId);
    // title patch, the old blocks deleted, 1 image (2 writes), 1 append, then the manifest page:
    // its 2 blocks deleted and 1 append.
    expect(server.writes - baseline).toBe(1 + oldBlocks + 2 + 1 + 3);
    expect(server.pages.size).toBe(4);
    expect(blockTexts(checkoutId).join("\n")).toContain("with new copy.");

    const settled = server.writes;
    const run3 = await publishWith(dir, second, { title_prefix: "[Docs] " });
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(server.writes).toBe(settled);
  });

  it("a changed screenshot uploads again and rewrites its page", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    const pageId = run1.pages[0]!.id;
    const oldBlocks = server.children(pageId).length;
    const baseline = server.writes;

    const changedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
    await fs.writeFile(path.join(dir, "docs", "login", "burned", "step-1.png"), changedPng);
    const changed = await projectDocPackToAdf({ workspaceDir: dir });
    const run2 = await publishWith(dir, changed);
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(pageId);
    // title patch, the old blocks deleted, 2 images (2 writes each), 1 append, 3 for the manifest.
    expect(server.writes - baseline).toBe(1 + oldBlocks + 4 + 1 + 3);
    expect(server.uploads.size).toBe(4);
    const newest = [...server.uploads.values()].filter(
      (u) => u.filename === "login--step-1.png",
    )[1]!;
    expect(newest.data!.equals(changedPng)).toBe(true);
    const imageIds = server
      .children(pageId)
      .filter((b) => b.type === "image")
      .map((b) => (b.body["file_upload"] as { id: string }).id);
    expect(imageIds).toContain(newest.id);
  });

  it("force writes every page again, in place", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    const run2 = await publishWith(dir, projection, { force: true });
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.pages.size).toBe(2);
  });

  it("creates a page again when it was trashed in Notion, once the push is forced", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    server.pages.get(run1.pages[0]!.id)!.archived = true;

    const baseline = server.writes;
    const quiet = await publishWith(dir, projection);
    expect(quiet.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(baseline);

    const { log, lines } = capture();
    const forced = await createNotionPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, log, { force: true }),
    );
    expect(forced.pages.map((p) => p.action)).toEqual(["created"]);
    expect(forced.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    expect(lines.filter((l) => l.includes("is not a page under"))).toHaveLength(0);
  });

  it("leaves a page somebody nested under the document page alone when it rewrites it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    const nested = seedPage("Team notes", run1.pages[0]!.id);

    await fs.writeFile(path.join(dir, "docs", "checkout", "step-1.md"), "New copy.\n", "utf8");
    const changed = await projectDocPackToAdf({ workspaceDir: dir });
    const run2 = await publishWith(dir, changed);
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(server.pages.get(nested.id)!.archived).toBe(false);
  });

  it("splits a long page into appends of at most 100 blocks, in order", async () => {
    const dir = await makeWorkspace();
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i}`);
    const projection = handProjection(
      lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    );
    const run = await publishWith(dir, projection);
    expect(server.appendSizes.slice(0, 3)).toEqual([100, 100, 50]);
    expect(server.appendSizes.every((n) => n <= 100)).toBe(true);
    expect(blockTexts(run.pages[0]!.id)).toEqual(lines);
  });

  it("publishes pages as rows of a database, with the title property from config", async () => {
    await server.close();
    server = await startFakeNotion(TOKEN, { titleProperty: "Doc title" });
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const config = { parent_page_id: undefined, database_id: server.databaseId };
    const run1 = await publishWith(dir, projection, { ...config, title_property: "Doc title" });
    expect(run1.target).toBe(`notion:database/${server.databaseId}`);
    expect(server.pages.get(run1.pages[0]!.id)!.parent).toEqual({
      type: "database_id",
      id: server.databaseId,
    });
    expect(manifestPage().parent.type).toBe("database_id");

    const baseline = server.writes;
    server.requests.length = 0;
    const run2 = await publishWith(dir, projection, { ...config, title_property: "Doc title" });
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(baseline);
    expect(server.requests).toContain("POST /v1/databases/{id}/query");

    // The default property name does not match this database, and Notion says so.
    await expect(publishWith(dir, projection, config)).rejects.toThrow(/HTTP 400/);
  });
});

describe("notion publisher: images", () => {
  it("uploads each screenshot byte for byte and attaches it as an image block", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run = await publishWith(dir, projection);

    const uploads = [...server.uploads.values()];
    const byName = new Map(uploads.map((u) => [u.filename, u]));
    expect(byName.get("checkout--step-1.png")!.data!.equals(PNG_A)).toBe(true);
    expect(byName.get("login--step-1.png")!.data!.equals(PNG_B)).toBe(true);
    for (const u of uploads) {
      expect(u.contentType).toBe("image/png");
      expect(u.status).toBe("uploaded");
      expect(u.attached).toBe(true);
    }
    const images = server.children(run.pages[0]!.id).filter((b) => b.type === "image");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.body["type"]).toBe("file_upload");
      const id = (image.body["file_upload"] as { id: string }).id;
      expect(server.uploads.get(id)).toBeDefined();
      expect(richPlain(image.body["caption"])).toMatch(/--step-1\.png$/);
    }
    expect(blockTexts(run.pages[0]!.id).join("\n")).not.toContain(dir);
  });

  it("publishes a screenshot over the upload limit as a note and uploads the rest", async () => {
    const dir = await makeWorkspace();
    const big = path.join(dir, "docs", "checkout", "burned", "step-1.png");
    await fs.truncate(big, MAX_UPLOAD_BYTES + 1); // sparse, costs no disk
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    const run = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));

    expect([...server.uploads.values()].map((u) => u.filename)).toEqual(["login--step-1.png"]);
    expect(blockTexts(run.pages[0]!.id).join("\n")).toContain(
      "checkout--step-1.png (20971521 bytes) is over Notion's 20971520 byte upload limit",
    );
    expect(lines.some((l) => l.includes("was not published"))).toBe(true);
  });

  it("uploads nothing for a screenshot the page does not use", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.adf = {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "No images here." }] }],
    };
    await publishWith(dir, projection);
    expect(server.uploads.size).toBe(0);
  });
});

describe("notion publisher: credentials", () => {
  it("sends the bearer token and the pinned version, and keeps the token out of everything", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();

    const result = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(server.authHeaders.length).toBeGreaterThan(0);
    expect(server.authHeaders.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
    expect(server.versions.every((v) => v === "2022-06-28")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    const everything = [
      ...lines,
      JSON.stringify(result),
      JSON.stringify([...server.pages.values()]),
      JSON.stringify([...server.blocks.values()]),
      ...[...server.uploads.values()].map((u) => u.data!.toString("latin1")),
    ].join("\n");
    expect(everything).not.toContain(TOKEN);
  });

  it("reads the token from the variable secretsEnv.token names", async () => {
    process.env["NOTION_OTHER_TOKEN"] = TOKEN;
    try {
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      const ctx = makeCtx(dir, projection, capture().log);
      ctx.secretsEnv = { token: "NOTION_OTHER_TOKEN" };
      const run = await createNotionPublisher(LOOPBACK).publish(ctx);
      expect(run.ok).toBe(true);
    } finally {
      delete process.env["NOTION_OTHER_TOKEN"];
    }
  });

  it("masks the token when the server echoes it in an error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    server.failEchoingSecrets = true;

    let message = "";
    try {
      await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 500");
    expect(message).toContain("<NOTION_TOKEN>");
    for (const text of [message, ...lines]) expect(text).not.toContain(TOKEN);
  });

  it("names the missing variable, never a value, and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.secretsEnv = { token: "NOTION_ABSENT_TOKEN" };
    await expect(createNotionPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(
      "set NOTION_ABSENT_TOKEN",
    );
    expect(server.requests).toEqual([]);
  });

  it("needs exactly one parent, and valid ids", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.config = { base_url: server.baseUrl };
    await expect(createNotionPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(
      "parent_page_id or config.database_id is required",
    );
    const id = randomUUID();
    expect(() => parseConfig({ parent_page_id: id, database_id: id })).toThrow(/not both/);
    expect(() => parseConfig({ parent_page_id: "../x" })).toThrow(
      /parent_page_id is not a Notion id/,
    );
    expect(() => parseConfig({ database_id: id, manifest_page_id: "a/b" })).toThrow(
      /manifest_page_id/,
    );
    expect(parseConfig({ parent_page_id: id.replaceAll("-", "").toUpperCase() }).parent.id).toBe(
      id,
    );
    expect(parseConfig({ database_id: id }).title_property).toBe("Name");
    expect(server.requests).toEqual([]);
  });
});

describe("notion plugin: manifest and runtime", () => {
  it("declares exactly one capability, the Notion API host, and stays private", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      private?: boolean;
      docsxai: { namespace: string; kinds: string[]; capabilities: string[]; trust: string };
    };
    expect(pkg.docsxai.capabilities).toEqual(["egress:api.notion.com"]);
    expect(pkg.docsxai.namespace).toBe("notion");
    expect(pkg.docsxai.kinds).toEqual(["publisher"]);
    expect(pkg.private).toBe(true);
  });

  it("resolvePlugins loads notion:push from the built package and it refuses a non-Notion endpoint", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:api.notion.com"],
    });
    const record = registry.pluginsInfo("notion");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "notion:push" }]);

    // The loaded publisher takes no test option, so it refuses the plain-http fake server.
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      registry.getPublisher("notion:push").publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow("base_url must be https");
    expect(server.authHeaders).toEqual([]);
  });

  it("is disabled when the egress capability is not operator-enabled", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: [],
    });
    expect(registry.pluginsInfo("notion")?.status).toBe("disabled-by-capability-mismatch");
  });
});

describe("notion publisher: base_url", () => {
  it.each([
    "https://api.notion.com/v1",
    "https://api.notion.com/v1//",
    "https://api.notion.com:443/v1",
  ])("accepts %s and normalises it", (url) => {
    expect(assertNotionBaseUrl(url)).toBe("https://api.notion.com/v1");
  });

  it.each([
    "http://api.notion.com/v1",
    "https://evil.example.com/v1",
    "https://api.notion.com.evil.example.com/v1",
    "https://evil.example.com/api.notion.com/v1",
    "https://user" + ":pw@api.notion.com/v1",
    "https://www.notion.so/v1",
    "https://notion.com/v1",
    "https://api.notion.com:8443/v1",
    "https://api.notion.com/v2",
    "https://api.notion.com/",
    "https://api.notion.com/v1/pages",
    "https://api.notion.com/v1?x=1",
    "https://api.notion.com/v1#x",
    "ftp://api.notion.com/v1",
    "api.notion.com/v1",
    "http://127.0.0.1:4000/v1",
    "http://localhost/v1",
  ])("refuses %s", (url) => {
    expect(() => assertNotionBaseUrl(url)).toThrow(/base_url/);
  });

  it("takes loopback http only under the explicit test option", () => {
    const loopback = { allowLoopbackHttp: true };
    expect(assertNotionBaseUrl("http://127.0.0.1:4000/v1", loopback)).toBe(
      "http://127.0.0.1:4000/v1",
    );
    expect(() => assertNotionBaseUrl("http://evil.example.com/v1", loopback)).toThrow(/base_url/);
    expect(() => assertNotionBaseUrl("https://127.0.0.1/v1", loopback)).toThrow(/base_url/);
  });

  it("parseConfig applies the same rule, and the default is the public API", () => {
    const parent_page_id = randomUUID();
    expect(parseConfig({ parent_page_id }).base_url).toBe("https://api.notion.com/v1");
    expect(() => parseConfig({ parent_page_id, base_url: "http://x.test/v1" })).toThrow(/base_url/);
  });

  it("the client refuses a host outside the allowlist before any request", () => {
    expect(() => new NotionClient("https://evil.example.com/v1", "t", (s) => s)).toThrow(
      /base_url/,
    );
  });

  it("publish with an off-list endpoint fails and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      publishWith(dir, projection, { base_url: "https://api.notion.com.evil.example.com/v1" }),
    ).rejects.toThrow(/base_url/);
    expect(server.authHeaders).toEqual([]);
  });

  it("the config cannot enable loopback http", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, { allowLoopbackHttp: true });
    await expect(createNotionPublisher().publish(ctx)).rejects.toThrow("base_url must be https");
    expect(server.authHeaders).toEqual([]);
  });

  it("isNotionUrl wants https on Notion's web host", () => {
    expect(isNotionUrl("https://www.notion.so/Title-abc")).toBe(true);
    expect(isNotionUrl("https://notion.so/abc")).toBe(true);
    expect(isNotionUrl("http://www.notion.so/abc")).toBe(false);
    expect(isNotionUrl("https://www.notion.so.evil.example.com/abc")).toBe(false);
    expect(isNotionUrl("https://u" + ":p@www.notion.so/abc")).toBe(false);
    expect(isNotionUrl("https://www.notion.so:8443/abc")).toBe(false);
    expect(isNotionUrl(42)).toBe(false);
  });

  it("normalizeId accepts a UUID with or without dashes and nothing else", () => {
    const id = randomUUID();
    expect(normalizeId(id.toUpperCase())).toBe(id);
    expect(normalizeId(id.replaceAll("-", ""))).toBe(id);
    expect(normalizeId(`${id}/x`)).toBeNull();
    expect(normalizeId("not-an-id")).toBeNull();
    expect(normalizeId(7)).toBeNull();
  });
});

describe("notion publisher: redirects", () => {
  it("does not follow a redirect on a page create, so the token stays on the first host", async () => {
    const other = await startFakeNotion(TOKEN);
    try {
      server.redirectWritesTo = `${other.baseUrl}/pages`;
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await expect(publishWith(dir, projection)).rejects.toThrow(/POST .* failed/);
      expect(other.authHeaders).toEqual([]);
      expect(other.pages.size).toBe(0);
    } finally {
      await other.close();
    }
  });

  it("does not follow a redirect on a page update either", async () => {
    const other = await startFakeNotion(TOKEN);
    try {
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await publishWith(dir, projection);

      await fs.writeFile(path.join(dir, "docs", "checkout", "step-1.md"), "New copy.\n", "utf8");
      const changed = await projectDocPackToAdf({ workspaceDir: dir });
      server.redirectWritesTo = `${other.baseUrl}/pages/${randomUUID()}`;
      await expect(publishWith(dir, changed)).rejects.toThrow(/PATCH .* failed/);
      expect(other.authHeaders).toEqual([]);
    } finally {
      await other.close();
    }
  });
});

describe("notion publisher: rate limits", () => {
  const count = (route: string) => server.requests.filter((r) => r === route).length;

  it("retries a 429 after its Retry-After, and the push still succeeds", async () => {
    const waits: number[] = [];
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.rateLimited.set("POST /v1/pages", 2);
    const run = await publishWith(
      dir,
      projection,
      {},
      { sleep: async (ms: number) => void waits.push(ms), maxRetryWaitMs: 5000 },
    );
    expect(run.pages.map((p) => p.action)).toEqual(["created"]);
    expect(waits).toEqual([1000, 1000]);
    expect(count("POST /v1/pages")).toBe(4); // two refused, the page, the manifest page
    expect(server.pages.size).toBe(2);
  });

  it("backs off from 1 s, doubling, when there is no Retry-After, and caps every wait", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);

    server.retryAfter = null;
    server.rateLimited.set("POST /v1/pages", 3);
    await publishWith(dir, projection, {}, { sleep, maxRetryWaitMs: 1500 });
    expect(waits).toEqual([1000, 1500, 1500]);

    waits.length = 0;
    server.retryAfter = "3600";
    server.rateLimited.set("POST /v1/file_uploads", 1);
    await publishWith(dir, projection, { force: true }, { sleep, maxRetryWaitMs: 5000 });
    expect(waits).toEqual([5000]);
  });

  it("gives up after 5 retries and reports the 429", async () => {
    const waits: number[] = [];
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.rateLimited.set("POST /v1/pages", 100);
    await expect(
      publishWith(dir, projection, {}, { sleep: async (ms: number) => void waits.push(ms) }),
    ).rejects.toThrow(/POST \/pages returned HTTP 429/);
    expect(count("POST /v1/pages")).toBe(6);
    expect(waits).toHaveLength(5);
    expect(server.pages.size).toBe(0);
  });

  it("spaces requests out, never by more than the configured interval", async () => {
    const waits: number[] = [];
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publishWith(
      dir,
      projection,
      {},
      { minIntervalMs: 100, sleep: async (ms: number) => void waits.push(ms) },
    );
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((w) => w > 0 && w <= 100)).toBe(true);
  });
});

describe("notion publisher: timeouts and partial failures", () => {
  const FAST = { apiTimeoutMs: 300, uploadTimeoutMs: 300 };

  it("ends a stalled API call with a timeout error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = ["GET /v1/blocks/{id}/children"];
    const started = Date.now();
    await expect(publishWith(dir, projection, {}, FAST)).rejects.toThrow(
      /GET \/blocks\/\{id\}\/children timed out after 300 ms/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(server.writes).toBe(0);
  });

  it("a stalled upload leaves a redo marker, and the next push finishes the page in place", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = ["POST /v1/file_uploads/{id}/send"];
    await expect(publishWith(dir, projection, {}, FAST)).rejects.toThrow(
      /POST \/file_uploads\/\{id\}\/send timed out after 300 ms/,
    );
    const pageId = [...server.pages.values()].find((p) => p.title !== MANIFEST_TITLE)!.id;
    expect(readManifest().pages["index"]).toMatchObject({ pageId, sha256: "" });

    server.stall = [];
    const run2 = await publishWith(dir, projection);
    expect(run2.pages.map((p) => [p.id, p.action])).toEqual([[pageId, "updated"]]);
    expect(readManifest().pages["index"]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const settled = server.writes;
    const run3 = await publishWith(dir, projection);
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(settled);
  });
});

describe("notion publisher: attachments", () => {
  it("refuses a source path outside the workspace and writes nothing", async () => {
    const dir = await makeWorkspace();
    const outside = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = path.join(
      outside,
      "docs",
      "checkout",
      "burned",
      "step-1.png",
    );
    await expect(publishWith(dir, projection)).rejects.toThrow(/escapes workspace root/);
    expect(server.writes).toBe(0);
  });

  it("refuses a source path that climbs out with ..", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = path.join(dir, "..", "etc-passwd");
    await expect(publishWith(dir, projection)).rejects.toThrow(/escapes workspace root/);
  });

  it("refuses a symlink inside the workspace that points outside", async () => {
    const dir = await makeWorkspace();
    const outside = await makeWorkspace();
    const link = path.join(dir, "docs", "checkout", "burned", "link.png");
    await fs.symlink(path.join(outside, "docs", "login", "burned", "step-1.png"), link);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = link;
    await expect(publishWith(dir, projection)).rejects.toThrow(/escapes workspace root/);
  });

  it("hashes the bytes it read, not the sha256 the projection claims", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const att of projection.documents[0]!.attachments) att.sha256 = "0".repeat(64);
    await publishWith(dir, projection);
    // A second push with the same wrong claim still sees the page as unchanged, and a changed
    // image behind the same claim is noticed.
    const before = server.writes;
    await publishWith(dir, projection);
    expect(server.writes).toBe(before);
    const edited = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    await fs.writeFile(path.join(dir, "docs", "login", "burned", "step-1.png"), edited);
    const run3 = await publishWith(dir, projection);
    expect(run3.pages.map((p) => p.action)).toEqual(["updated"]);
  });

  async function publishEdited(
    dir: string,
    edit: (att: { sourcePath: string; sha256: string }) => void,
  ): Promise<unknown> {
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    edit(projection.documents[0]!.attachments[0]);
    return publishWith(dir, projection);
  }

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO without waiting for a writer",
    async () => {
      const dir = await makeWorkspace();
      const fifo = path.join(dir, "docs", "checkout", "burned", "pipe.png");
      await promisify(execFile)("mkfifo", [fifo]);
      const outcome = await Promise.race([
        publishEdited(dir, (att) => {
          att.sourcePath = fifo;
        }).then(
          () => "published",
          (e: unknown) => (e as Error).message,
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 5000)),
      ]);
      expect(outcome).toContain("is not a regular file");
      expect(server.writes).toBe(0);
    },
    10_000,
  );

  it("refuses a symlink to a file inside the workspace", async () => {
    const dir = await makeWorkspace();
    const link = path.join(dir, "docs", "checkout", "burned", "link.png");
    await fs.symlink(path.join(dir, "docs", "login", "burned", "step-1.png"), link);
    await expect(
      publishEdited(dir, (att) => {
        att.sourcePath = link;
      }),
    ).rejects.toThrow(/is a symlink/);
    expect(server.writes).toBe(0);
  });

  it("refuses a file over the read cap before reading it", async () => {
    const dir = await makeWorkspace();
    const big = path.join(dir, "docs", "checkout", "burned", "big.png");
    await fs.writeFile(big, "");
    await fs.truncate(big, MAX_IMAGE_BYTES + 1); // sparse, costs no disk
    await expect(
      publishEdited(dir, (att) => {
        att.sourcePath = big;
      }),
    ).rejects.toThrow(/is larger than/);
    expect(server.writes).toBe(0);
  });

  it("reads a file bigger than one read chunk byte for byte", async () => {
    const dir = await makeWorkspace();
    const data = Buffer.alloc(2 * 1024 * 1024 + 5, 3);
    await fs.writeFile(path.join(dir, "docs", "checkout", "burned", "step-1.png"), data);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publishWith(dir, projection);
    const upload = [...server.uploads.values()].find((u) => u.filename === "checkout--step-1.png")!;
    expect(upload.data!.equals(data)).toBe(true);
  });
});

describe("notion publisher: names", () => {
  it.each([".", "..", "...", "-.-", " .. "])("safeName refuses the all-dot name %j", (raw) => {
    expect(() => safeName(raw)).toThrow(/not a usable name/);
  });

  it("safeName keeps ordinary names, dots inside included", () => {
    expect(safeName("a..b")).toBe("a..b");
    expect(safeName("checkout--step-1.png")).toBe("checkout--step-1.png");
    expect(safeName("")).toBe("item");
  });
});

describe("notion publisher: manifest page", () => {
  const goodSha = "a".repeat(64);

  it("round trips through the code blocks, however many the JSON needs", () => {
    const manifest = emptyManifest();
    for (let i = 0; i < 40; i++) {
      manifest.pages[`flow-${i}`] = {
        pageId: randomUUID(),
        sha256: goodSha,
        url: `https://www.notion.so/Flow-${i}`,
      };
    }
    const blocks = manifestBlocks(manifest);
    const text = blocks
      .filter((b) => b["type"] === "code")
      .map((b) =>
        (b["code"] as { rich_text: Array<{ text: { content: string } }> }).rich_text
          .map((r) => r.text.content)
          .join(""),
      )
      .join("");
    expect(text.length).toBeGreaterThan(4000);
    expect(parseManifestText(text, () => {}, "t").pages).toEqual(manifest.pages);
  });

  it("repairs damaged entries without losing a page id, and warns once per entry", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    const good = readManifest().pages["index"]!;
    const damaged = {
      schema: MANIFEST_SCHEMA,
      pages: {
        index: { ...good, sha256: "XYZ", url: "https://evil.example.com/phish" },
        bogus: { pageId: "nope", sha256: "x" },
      },
    };
    setManifestText(JSON.stringify(damaged));

    const { log, lines } = capture();
    const run2 = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.pages.size).toBe(2);
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(2);
    expect(JSON.stringify(run2)).not.toContain("evil.example.com");
    expect(manifestText(manifestPage().id)).not.toContain("evil.example.com");
  });

  it("does not rewrite a page outside the parent that the manifest points at", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publishWith(dir, projection);
    const victim = seedPage("Somebody else's page", randomUUID());
    seedBlocks(victim.id, codeBlocks("not ours"));

    const good = readManifest().pages["index"]!;
    setManifestText(
      JSON.stringify({
        schema: MANIFEST_SCHEMA,
        pages: { index: { ...good, pageId: victim.id, sha256: "0".repeat(64) } },
      }),
    );
    const { log, lines } = capture();
    const run2 = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe(victim.id);
    expect(run2.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    expect(server.pages.get(victim.id)!.title).toBe("Somebody else's page");
    expect(server.pages.get(victim.id)!.archived).toBe(false);
    expect(manifestText(victim.id)).toBe("not ours");
    expect(
      lines.filter((l) => l.includes("is not a page under the configured parent")),
    ).toHaveLength(1);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);
  });

  it("does not overwrite the manifest page when a page entry points at it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publishWith(dir, projection);
    const manifestId = manifestPage().id;
    const good = readManifest().pages["index"]!;
    setManifestText(
      JSON.stringify({
        schema: MANIFEST_SCHEMA,
        pages: { index: { ...good, pageId: manifestId, sha256: "0".repeat(64) } },
      }),
    );
    const run2 = await publishWith(dir, projection);
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe(manifestId);
    expect(manifestPage().title).toBe(MANIFEST_TITLE);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);
  });

  it("names at most 20 invalid manifest entries, then counts the rest in one line", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const pages: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) pages[`x-${i}`] = { pageId: randomUUID(), sha256: "nope" };
    seedManifest(JSON.stringify({ schema: MANIFEST_SCHEMA, pages }));
    const { log, lines } = capture();
    await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(20);
    expect(lines.filter((l) => l.includes("5 more manifest entries are not valid"))).toHaveLength(
      1,
    );
  });

  it("refuses a manifest page it cannot read, so a push never starts over", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const text of [
      "edited by hand",
      "{not json",
      JSON.stringify({ schema: MANIFEST_SCHEMA, pages: [1] }),
      JSON.stringify({ schema: "other@1", pages: {} }),
    ]) {
      server.pages.clear();
      server.blocks.clear();
      seedManifest(text);
      await expect(publishWith(dir, projection)).rejects.toThrow("is not a docsxai manifest");
      expect(server.writes).toBe(0);
    }
  });

  it("drops the later of two entries that name one page", () => {
    const id = randomUUID();
    const warnings: string[] = [];
    const text = JSON.stringify({
      schema: MANIFEST_SCHEMA,
      pages: { a: { pageId: id, sha256: goodSha }, b: { pageId: id, sha256: goodSha } },
    });
    const manifest = parseManifestText(text, (m) => warnings.push(m), "t");
    expect(Object.keys(manifest.pages)).toEqual(["a"]);
    expect(warnings).toEqual(['manifest entry "b" is not valid, redoing it']);
  });

  it("gives the dropped entry a page of its own on the next push", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run1 = await publishWith(dir, projection);
    const entries = readManifest().pages;
    setManifestText(
      JSON.stringify({
        schema: MANIFEST_SCHEMA,
        pages: {
          checkout: entries["checkout"],
          login: entries["checkout"],
          index: entries["index"],
        },
      }),
    );
    const { log, lines } = capture();
    const run2 = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "unchanged"],
      ["checkout", "unchanged"],
      ["login", "created"],
    ]);
    expect(run2.pages[2]!.id).not.toBe(run1.pages[2]!.id);
    expect(lines.filter((l) => l.includes('manifest entry "login" is not valid'))).toHaveLength(1);
  });

  it("treats an empty manifest page as an interrupted write and rewrites it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publishWith(dir, projection);
    const manifestId = manifestPage().id;
    for (const b of server.children(manifestId)) b.archived = true;

    const { log, lines } = capture();
    const run2 = await createNotionPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.ok).toBe(true);
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(
      lines.filter((l) => l.includes("is empty, so an earlier push was interrupted")),
    ).toHaveLength(1);
    expect(manifestPage().id).toBe(manifestId);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);

    const run3 = await publishWith(dir, projection);
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged"]);
  });

  it("treats a whitespace-only manifest page like an empty one", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    seedManifest("  \n ");
    const run = await publishWith(dir, projection);
    expect(run.pages.map((p) => p.action)).toEqual(["created"]);
    expect(readManifest().pages["index"]).toBeDefined();
    expect(server.pagesTitled(MANIFEST_TITLE)).toHaveLength(1);
  });

  it("keeps a __proto__ key in the manifest from touching prototypes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const entry = JSON.stringify({ pageId: randomUUID(), sha256: goodSha });
    seedManifest(`{"schema":"${MANIFEST_SCHEMA}","pages":{"__proto__":${entry}}}`);
    await publishWith(dir, projection);
    expect(({} as Record<string, unknown>)["pageId"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["sha256"]).toBeUndefined();
  });

  it("refuses two manifest pages under the parent, and ignores one under another parent", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const empty = JSON.stringify({ schema: MANIFEST_SCHEMA, pages: {} });
    const elsewhere = seedManifest(empty, randomUUID());
    await publishWith(dir, projection);
    expect(manifestText(elsewhere.id)).toBe(empty);

    seedManifest(empty);
    await expect(publishWith(dir, projection)).rejects.toThrow(/2 pages titled "docsxai manifest"/);
  });

  it("finds the manifest on a later list page, and a pinned id skips the parent listing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publishWith(dir, projection);
    const writes = server.writes;
    const listings = () => server.requests.filter((r) => r === "GET /v1/blocks/{id}/children");

    server.listPageSize = 1;
    const run2 = await publishWith(dir, projection);
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(writes);

    server.listPageSize = 100;
    server.requests.length = 0;
    await publishWith(dir, projection);
    expect(listings()).toHaveLength(2); // the parent, then the manifest page

    server.requests.length = 0;
    const pinned = await publishWith(dir, projection, { manifest_page_id: manifestPage().id });
    expect(pinned.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(listings()).toHaveLength(1); // the manifest page only
    expect(server.writes).toBe(writes);
  });

  it("refuses a pinned manifest page that is missing or under another parent", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(publishWith(dir, projection, { manifest_page_id: randomUUID() })).rejects.toThrow(
      "does not exist",
    );
    const elsewhere = seedManifest("{}", randomUUID());
    await expect(publishWith(dir, projection, { manifest_page_id: elsewhere.id })).rejects.toThrow(
      "is not under the configured parent",
    );
    expect(server.writes).toBe(0);
  });

  it("asks for manifest_page_id when the parent has too many children to search", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (let i = 0; i < 25; i++) seedPage(`Other ${i}`);
    server.listPageSize = 1;
    await expect(publishWith(dir, projection)).rejects.toThrow(/set config\.manifest_page_id/);
    expect(server.writes).toBe(0);
  });
});

describe("notion client: bounded responses", () => {
  it("refuses a body over the limit, with or without a content-length", async () => {
    await expect(readBoundedText(new Response("x".repeat(100)), 10)).rejects.toThrow(
      /over 10 bytes/,
    );
    const streamed = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("x".repeat(6)));
          c.enqueue(new TextEncoder().encode("x".repeat(6)));
          c.close();
        },
      }),
    );
    await expect(readBoundedText(streamed, 10)).rejects.toThrow(/over 10 bytes/);
  });

  it("reads a body at the limit and truncates an error body instead of refusing it", async () => {
    expect(await readBoundedText(new Response("x".repeat(10)), 10)).toBe("x".repeat(10));
    expect(await readBoundedText(new Response("y".repeat(100)), 10, true)).toBe("y".repeat(10));
  });

  it("refuses a listing over 8 MiB and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.oversize = ["GET /v1/blocks/{id}/children"];
    await expect(publishWith(dir, projection)).rejects.toThrow(
      new RegExp(`over ${MAX_RESPONSE_BYTES} bytes`),
    );
    expect(server.writes).toBe(0);
  });

  it("refuses a pinned manifest page whose listing is over 8 MiB", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const page = seedManifest("{}");
    server.oversize = ["GET /v1/blocks/{id}/children"];
    await expect(publishWith(dir, projection, { manifest_page_id: page.id })).rejects.toThrow(
      new RegExp(`over ${MAX_RESPONSE_BYTES} bytes`),
    );
    expect(server.writes).toBe(0);
  });
});

describe("adf to notion blocks", () => {
  const noImages = () => undefined;
  const doc = (content: AdfNode[]): AdfDoc => ({ version: 1, type: "doc", content });
  const text = (value: string, marks?: AdfNode["marks"]): AdfNode => ({
    type: "text",
    text: value,
    ...(marks ? { marks } : {}),
  });
  const para = (...content: AdfNode[]): AdfNode => ({ type: "paragraph", content });

  it("renders the engine's markdown subset", () => {
    const source = [
      "Use **bold**, *em* and `code` with a [link](https://example.com/a).",
      "- first\n- second",
      "1. one\n2. two",
      "```\nnpm run build\n```",
    ].join("\n\n");
    const blocks = adfToBlocks(doc(markdownToAdf(source)), noImages);
    const items = (blocks[0]!["paragraph"] as { rich_text: Array<Record<string, unknown>> })
      .rich_text;
    const find = (content: string) =>
      items.find((i) => (i["text"] as { content: string }).content === content)!;
    expect(find("bold")["annotations"]).toEqual({ bold: true });
    expect(find("em")["annotations"]).toEqual({ italic: true });
    expect(find("code")["annotations"]).toEqual({ code: true });
    expect((find("link")["text"] as { link: unknown }).link).toEqual({
      url: "https://example.com/a",
    });
    expect(blocks.map((b) => b["type"])).toEqual([
      "paragraph",
      "bulleted_list_item",
      "bulleted_list_item",
      "numbered_list_item",
      "numbered_list_item",
      "code",
    ]);
    expect(blocks[5]).toEqual({
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: "npm run build" } }],
        language: "plain text",
      },
    });
  });

  it("clamps heading levels to the three Notion has, and drops empty blocks", () => {
    const heading = (level: unknown): AdfNode => ({
      type: "heading",
      ...(level === undefined ? {} : { attrs: { level } }),
      content: [text("H")],
    });
    const blocks = adfToBlocks(
      doc([heading(1), heading(2), heading(3), heading(6), heading(undefined), para()]),
      noImages,
    );
    expect(blocks.map((b) => b["type"])).toEqual([
      "heading_1",
      "heading_2",
      "heading_3",
      "heading_3",
      "heading_2",
    ]);
  });

  it("splits text at 2000 characters and arrays at 100 items, never inside a surrogate pair", () => {
    const long = adfToBlocks(doc([para(text("a".repeat(4500)))]), noImages);
    const items = (long[0]!["paragraph"] as { rich_text: Array<{ text: { content: string } }> })
      .rich_text;
    expect(items.map((i) => i.text.content.length)).toEqual([2000, 2000, 500]);

    const many = adfToBlocks(
      doc([para(...Array.from({ length: 250 }, () => text("a")))]),
      noImages,
    );
    const sizes = many.map((b) => (b["paragraph"] as { rich_text: unknown[] }).rich_text.length);
    expect(sizes).toEqual([100, 100, 50]);

    const emoji = splitText(`a${"😀".repeat(1000)}`);
    expect(emoji.join("")).toBe(`a${"😀".repeat(1000)}`);
    expect(emoji.map((part) => part.length)).toEqual([1999, 2]);
    for (const part of emoji) {
      expect(part).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
      );
    }
    expect(splitText("")).toEqual([]);
  });

  it("keeps a link only when it is http, https or mailto", () => {
    const link = (href: string) => text("t", [{ type: "link", attrs: { href } }]);
    const blocks = adfToBlocks(
      doc([
        para(link("javascript:alert(1)")),
        para(link("mailto:docs@example.com")),
        para(link(`https://example.com/${"x".repeat(2100)}`)),
      ]),
      noImages,
    );
    const first = (i: number) =>
      (blocks[i]!["paragraph"] as { rich_text: Array<{ text: Record<string, unknown> }> })
        .rich_text[0]!.text;
    expect(first(0)["link"]).toBeUndefined();
    expect(first(1)["link"]).toEqual({ url: "mailto:docs@example.com" });
    expect(first(2)["link"]).toBeUndefined();
  });

  it("turns an image into an image block, a note into a paragraph, and an unknown image into nothing", () => {
    const media = (alt: string): AdfNode => ({
      type: "mediaSingle",
      content: [{ type: "media", attrs: { alt } }],
    });
    const blocks = adfToBlocks(doc([media("a.png"), media("b.png"), media("c.png")]), (name) =>
      name === "a.png"
        ? { fileUploadId: "up-1" }
        : name === "b.png"
          ? { note: "too big" }
          : undefined,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: "up-1" },
        caption: [{ type: "text", text: { content: "a.png" } }],
      },
    });
    expect(blocks[1]!["type"]).toBe("paragraph");
  });

  it("is deterministic: the same document gives the same bytes", () => {
    const content = markdownToAdf("Some **text**.\n\n- a\n- b");
    const once = JSON.stringify(adfToBlocks(doc(content), noImages));
    expect(JSON.stringify(adfToBlocks(doc(content), noImages))).toBe(once);
    expect(createHash("sha256").update(once).digest("hex")).toHaveLength(64);
  });
});
