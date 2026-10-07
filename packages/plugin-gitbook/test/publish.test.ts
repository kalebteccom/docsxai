// Publisher suite against the in-process fake GitBook server: idempotent re-push (zero writes, no
// empty change request), in-place page updates, screenshots sent inline, the token absent from
// every log line and error, the exact capability declaration, the base URL allowlist, redirect
// refusal on writes, bounded responses and timeouts, an archived draft when a push fails,
// workspace-confined attachment reads, and the load through the real plugin runtime.

import { execFile } from "node:child_process";
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
import { adfToMarkdown, pageSlug, safeName, withTitle } from "../src/adf-markdown.js";
import { parseConfig } from "../src/config.js";
import {
  GitBookClient,
  MAX_RESPONSE_BYTES,
  assertGitBookBaseUrl,
  isGitBookAppUrl,
  readBoundedText,
} from "../src/gitbook-client.js";
import {
  MANIFEST_SCHEMA,
  MANIFEST_TITLE,
  type Manifest,
  emptyManifest,
  manifestToMarkdown,
  parseManifestMarkdown,
} from "../src/manifest.js";
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_PAGE_IMAGE_BYTES,
  MAX_PAGE_MARKDOWN_BYTES,
  createGitBookPublisher,
} from "../src/publisher.js";
import { MAX_IMAGE_BYTES, readRegularFile } from "../src/read-file.js";
import { type FakeGitBook, type FakePage, startFakeGitBook } from "./fake-gitbook.js";

/** The fake GitBook server is plain http on loopback, which the publisher refuses unless told otherwise. */
const LOOPBACK = { allowLoopbackHttp: true } as const;

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "gb_api_9f8e7d6c5b4a43210abcdef0123456789abcdef";
const SPACE = "space-1";

const tempDirs: string[] = [];
let server: FakeGitBook;

beforeAll(() => {
  process.env["GITBOOK_TOKEN"] = TOKEN;
});
afterAll(async () => {
  delete process.env["GITBOOK_TOKEN"];
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});
beforeEach(async () => {
  server = await startFakeGitBook(TOKEN);
});
afterEach(async () => {
  await server.close();
});

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

/** Two flows, one documented step each: enough for both modes and for image upload. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-gitbook-test-"));
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
    config: { space_id: SPACE, base_url: server.baseUrl, ...extraConfig },
    secretsEnv: { token: "GITBOOK_TOKEN" },
    log,
  };
}

function pagesTitled(title: string): FakePage[] {
  return [...server.pages.values()].filter((p) => p.title === title);
}

function manifestPage(): FakePage {
  const found = pagesTitled(MANIFEST_TITLE);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function readManifest(): Manifest {
  return parseManifestMarkdown(manifestPage().markdown, () => {}, "test");
}

/** Replaces the manifest page's body, as an editor in the GitBook app could. */
function writeManifest(manifest: unknown): void {
  manifestPage().markdown = manifestToMarkdown(manifest as Manifest);
}

const PAGE_TREE = { mode: "page-tree" as const, title: "Shop docs" };

describe("gitbook publisher: idempotency (fake GitBook)", () => {
  it("pushes a single-mode pack twice: the second push opens no change request and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createGitBookPublisher(LOOPBACK);
    const { log } = capture();

    const run1 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run1.ok).toBe(true);
    expect(run1.target).toBe(`gitbook:space/${SPACE}`);
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([["project", "created"]]);
    expect(run1.pages[0]!.url).toMatch(/^https:\/\/app\.gitbook\.com\//);
    // one change request, one page batch, one manifest batch, one merge
    expect(server.writes).toBe(4);
    expect(server.batches).toBe(2);
    expect(server.changeRequests.size).toBe(1);
    expect(server.pages.size).toBe(2);
    expect(server.files.map((f) => f.name).sort()).toEqual([
      "checkout--step-1.png",
      "login--step-1.png",
    ]);

    const writesAfterRun1 = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(run2.pages[0]!.url).toBe(run1.pages[0]!.url);
    expect(server.writes).toBe(writesAfterRun1);
    expect(server.changeRequests.size).toBe(1);
    expect(server.pages.size).toBe(2);
  });

  it("updates the same page in place, in one change request, and a repeat writes nothing", async () => {
    const dir = await makeWorkspace();
    const publisher = createGitBookPublisher(LOOPBACK);
    const { log } = capture();

    const first = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run1 = await publisher.publish(makeCtx(dir, first, log, { title_prefix: "[Docs] " }));
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "created"],
      ["checkout", "created"],
      ["login", "created"],
    ]);
    expect(pagesTitled("[Docs] Shop docs")).toHaveLength(1);
    expect(server.writes).toBe(6); // change request, 3 page batches, manifest batch, merge
    expect(server.changeRequests.size).toBe(1);
    expect(server.pages.size).toBe(4);
    const checkoutId = run1.pages[1]!.id;
    const baseline = server.writes;

    await fs.writeFile(
      path.join(dir, "docs", "checkout", "step-1.md"),
      "Go to **checkout** with new copy.\n",
      "utf8",
    );
    const second = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run2 = await publisher.publish(makeCtx(dir, second, log, { title_prefix: "[Docs] " }));
    expect(run2.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "unchanged"],
      ["checkout", "updated"],
      ["login", "unchanged"],
    ]);
    expect(run2.pages[1]!.id).toBe(checkoutId);
    expect(server.writes - baseline).toBe(4); // change request, page batch, manifest batch, merge
    expect(server.changeRequests.size).toBe(2);
    expect(server.pages.size).toBe(4);
    expect(server.pages.get(checkoutId)!.markdown).toContain("with new copy.");
    expect(server.pages.get(checkoutId)!.version).toBe(2);

    const settled = server.writes;
    const run3 = await publisher.publish(makeCtx(dir, second, log, { title_prefix: "[Docs] " }));
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(server.writes).toBe(settled);
    expect(server.changeRequests.size).toBe(2);
  });

  it("a changed screenshot sends that page's images again and updates its page only", async () => {
    const dir = await makeWorkspace();
    const publisher = createGitBookPublisher(LOOPBACK);
    const { log } = capture();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await publisher.publish(makeCtx(dir, projection, log));
    const baseline = server.writes;

    await fs.writeFile(
      path.join(dir, "docs", "login", "burned", "step-1.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]),
    );
    const changed = await projectDocPackToAdf({ workspaceDir: dir });
    const run2 = await publisher.publish(makeCtx(dir, changed, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(server.writes - baseline).toBe(4);
    expect(server.files).toHaveLength(4);
    const newest = server.files.filter((f) => f.name === "login--step-1.png").at(-1)!;
    expect(newest.data[8]).toBe(9);
    expect(server.pages.get(run2.pages[0]!.id)!.markdown).toContain(`/files/${newest.id}`);
  });

  it("force writes every page again, updating pages in place", async () => {
    const dir = await makeWorkspace();
    const publisher = createGitBookPublisher(LOOPBACK);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publisher.publish(makeCtx(dir, projection, capture().log));
    const baseline = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, capture().log, { force: true }));
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.writes - baseline).toBe(4);
    expect(server.pages.size).toBe(2);
  });

  it("creates a page again when it was deleted in GitBook", async () => {
    const dir = await makeWorkspace();
    const publisher = createGitBookPublisher(LOOPBACK);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publisher.publish(makeCtx(dir, projection, capture().log));
    server.pages.delete(run1.pages[0]!.id);

    const { log, lines } = capture();
    const run2 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    expect(server.pages.has(run2.pages[0]!.id)).toBe(true);
    expect(lines.filter((l) => l.includes("is not a page at the top level"))).toHaveLength(1);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);
  });

  it("puts the title in frontmatter, the slug on the page and the manifest page out of sight", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    const checkout = server.pages.get(run.pages[1]!.id)!;
    expect(checkout.slug).toBe("checkout");
    expect(
      checkout.markdown.startsWith(`---\ntitle: ${JSON.stringify(checkout.title)}\n---\n`),
    ).toBe(true);
    expect(checkout.hidden).toBe(false);
    const manifest = manifestPage();
    expect(manifest.hidden).toBe(true);
    expect(manifest.noIndex).toBe(true);
    expect(manifest.slug).toBe("docsxai-manifest");
    expect(run.pages.map((p) => p.id)).not.toContain(manifest.id);
  });

  it("creates pages under parent_page_id, and an unknown parent fails before any write", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    server.seedPage({ id: "home", title: "Home" });
    const publisher = createGitBookPublisher(LOOPBACK);

    const run1 = await publisher.publish(
      makeCtx(dir, projection, capture().log, { parent_page_id: "home" }),
    );
    for (const page of run1.pages) expect(server.pages.get(page.id)!.parent).toBe("home");
    expect(manifestPage().parent).toBe("home");
    const writes = server.writes;
    const run2 = await publisher.publish(
      makeCtx(dir, projection, capture().log, { parent_page_id: "home" }),
    );
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(server.writes).toBe(writes);

    await expect(
      publisher.publish(makeCtx(dir, projection, capture().log, { parent_page_id: "nope" })),
    ).rejects.toThrow("parent page nope is not in the space");
    expect(server.writes).toBe(writes);
  });
});

describe("gitbook publisher: images", () => {
  it("sends each screenshot byte for byte and links it by file id", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );

    const byName = new Map(server.files.map((f) => [f.name, f]));
    expect(byName.get("checkout--step-1.png")!.data.equals(PNG_A)).toBe(true);
    expect(byName.get("login--step-1.png")!.data.equals(PNG_B)).toBe(true);
    expect(byName.get("login--step-1.png")!.contentType).toBe("image/png");
    const markdown = server.pages.get(run.pages[0]!.id)!.markdown;
    for (const [name, file] of byName) expect(markdown).toContain(`![${name}](/files/${file.id})`);
    expect(markdown).toContain("Go to **checkout**.");
    expect(markdown).not.toContain(dir);
  });

  it("leaves out a screenshot over the inline limit, names it, and still publishes the page", async () => {
    const dir = await makeWorkspace();
    await fs.writeFile(
      path.join(dir, "docs", "checkout", "burned", "step-1.png"),
      Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1, 7),
    );
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createGitBookPublisher(LOOPBACK);
    const run = await publisher.publish(makeCtx(dir, projection, capture().log));

    expect(server.files.map((f) => f.name)).toEqual(["login--step-1.png"]);
    expect(
      run.warnings.some((w) => w.includes("checkout--step-1.png") && w.includes("not uploaded")),
    ).toBe(true);
    expect(server.pages.get(run.pages[0]!.id)!.markdown).toContain(
      "*Screenshot not uploaded: checkout--step-1.png*",
    );
    const writes = server.writes;
    const again = await publisher.publish(makeCtx(dir, projection, capture().log));
    expect(again.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(writes);
  });
});

describe("gitbook publisher: failure leaves nothing live", () => {
  it("archives the draft and writes no manifest when GitBook rejects a batch", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.rejectContent = "Invalid markdown";
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/HTTP 400.*Invalid markdown/);
    expect(server.pages.size).toBe(0);
    expect(server.batches).toBe(0);
    expect([...server.changeRequests.values()].map((c) => c.status)).toEqual(["archived"]);
  });

  it("fails a merge with conflicts and marks its pages to be written again", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.conflictMerges = 1;
    const { log, lines } = capture();
    const publisher = createGitBookPublisher(LOOPBACK);
    const run = await publisher.publish(makeCtx(dir, projection, log));
    expect(run.ok).toBe(false);
    expect(run.warnings.some((w) => w.includes("merged with conflicts"))).toBe(true);
    expect(lines.some((l) => l.includes("merged with conflicts"))).toBe(true);
    // the pages landed, but the manifest does not vouch for them
    expect(server.pages.size).toBe(2);
    expect(server.changeRequests.size).toBe(2);
    expect(readManifest().pages["index"]).toEqual({ pageId: run.pages[0]!.id, sha256: "" });

    const run2 = await publisher.publish(makeCtx(dir, projection, capture().log));
    expect(run2.ok).toBe(true);
    expect(run2.pages.map((p) => [p.id, p.action])).toEqual([[run.pages[0]!.id, "updated"]]);
    expect(server.pages.size).toBe(2);
    const writes = server.writes;
    const run3 = await publisher.publish(makeCtx(dir, projection, capture().log));
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(writes);
  });

  it("asks for force when the manifest reset conflicts as well", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.mergeResult = "conflicts";
    const run = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(run.ok).toBe(false);
    expect(run.warnings.join("\n")).toContain("config.force");
  });
});

describe("gitbook publisher: credentials", () => {
  it("sends the token as a bearer header only and keeps it out of logs, results and GitBook", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();

    const result = await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(server.authHeaders.length).toBeGreaterThan(0);
    expect(server.authHeaders.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
    expect(server.requests.every((r) => !r.includes(TOKEN))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    const everything = [
      ...lines,
      JSON.stringify(result),
      JSON.stringify([...server.pages.values()]),
      ...server.files.map((f) => f.data.toString("latin1")),
    ].join("\n");
    expect(everything).not.toContain(TOKEN);
  });

  it("masks the token when the server echoes it in an error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    server.failEchoingToken = true;

    let message = "";
    try {
      await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 500");
    expect(message).toContain("<GITBOOK_TOKEN>");
    for (const text of [message, ...lines]) expect(text).not.toContain(TOKEN);
  });

  it("names the missing variable, never a value, and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const noToken = makeCtx(dir, projection, capture().log);
    noToken.secretsEnv = { token: "GITBOOK_ABSENT_TOKEN" };
    await expect(createGitBookPublisher(LOOPBACK).publish(noToken)).rejects.toThrow(
      "set GITBOOK_ABSENT_TOKEN",
    );
    expect(server.requests).toEqual([]);
  });

  it("reads the default variable name when secretsEnv names none", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.secretsEnv = {};
    const run = await createGitBookPublisher(LOOPBACK).publish(ctx);
    expect(run.ok).toBe(true);
  });

  it("requires a space and valid ids", () => {
    expect(() => parseConfig({})).toThrow(/space_id/);
    expect(() => parseConfig({ space_id: "../s" })).toThrow(/space_id/);
    expect(() => parseConfig({ space_id: "s", parent_page_id: "a/b" })).toThrow(/parent_page_id/);
    expect(() => parseConfig({ space_id: "s", manifest_page_id: "a b" })).toThrow(
      /manifest_page_id/,
    );
    expect(parseConfig({ space_id: "s", force: true, title_prefix: "x" })).toMatchObject({
      space_id: "s",
      force: true,
      title_prefix: "x",
    });
  });
});

describe("gitbook plugin: manifest and runtime", () => {
  it("declares exactly one capability, the GitBook API host, and stays private", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      private?: boolean;
      docsxai: { namespace: string; kinds: string[]; capabilities: string[]; trust: string };
    };
    expect(pkg.docsxai.capabilities).toEqual(["egress:api.gitbook.com"]);
    expect(pkg.docsxai.namespace).toBe("gitbook");
    expect(pkg.docsxai.kinds).toEqual(["publisher"]);
    expect(pkg.private).toBe(true);
  });

  it("resolvePlugins loads gitbook:push from the built package and it refuses a non-GitBook endpoint", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:api.gitbook.com"],
    });
    const record = registry.pluginsInfo("gitbook");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "gitbook:push" }]);

    // The loaded publisher takes no test option, so it refuses the plain-http fake server.
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      registry.getPublisher("gitbook:push").publish(makeCtx(dir, projection, capture().log)),
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
    expect(registry.pluginsInfo("gitbook")?.status).toBe("disabled-by-capability-mismatch");
  });
});

describe("gitbook publisher: base_url", () => {
  it.each([
    "https://api.gitbook.com/v1",
    "https://api.gitbook.com/v1//",
    "https://api.gitbook.com:443/v1",
  ])("accepts %s and normalises it", (url) => {
    expect(assertGitBookBaseUrl(url)).toBe("https://api.gitbook.com/v1");
  });

  it.each([
    "http://api.gitbook.com/v1",
    "https://evil.example.com/v1",
    "https://api.gitbook.com.evil.example.com/v1",
    "https://evil.example.com/api.gitbook.com/v1",
    "https://user" + ":pw@api.gitbook.com/v1",
    "https://app.gitbook.com/v1",
    "https://gitbook.com/v1",
    "https://api.gitbook.com:8443/v1",
    "https://api.gitbook.com/v2",
    "https://api.gitbook.com/",
    "https://api.gitbook.com/v1/spaces",
    "https://api.gitbook.com/v1?x=1",
    "https://api.gitbook.com/v1#x",
    "ftp://api.gitbook.com/v1",
    "api.gitbook.com/v1",
    "http://127.0.0.1:4000/v1",
    "http://localhost/v1",
  ])("refuses %s", (url) => {
    expect(() => assertGitBookBaseUrl(url)).toThrow(/base_url/);
  });

  it("takes loopback http only under the explicit test option", () => {
    expect(assertGitBookBaseUrl("http://127.0.0.1:4000/v1", LOOPBACK)).toBe(
      "http://127.0.0.1:4000/v1",
    );
    expect(() => assertGitBookBaseUrl("http://evil.example.com/v1", LOOPBACK)).toThrow(/base_url/);
    expect(() => assertGitBookBaseUrl("https://127.0.0.1/v1", LOOPBACK)).toThrow(/base_url/);
  });

  it("parseConfig applies the same rule, and the default is the public API", () => {
    expect(parseConfig({ space_id: "s" }).base_url).toBe("https://api.gitbook.com/v1");
    expect(() => parseConfig({ space_id: "s", base_url: "http://x.test/v1" })).toThrow(/base_url/);
  });

  it("the client refuses a host outside the allowlist before any request", () => {
    expect(() => new GitBookClient("https://evil.example.com/v1", "t", (s) => s)).toThrow(
      /base_url/,
    );
  });

  it("publish with an off-list endpoint fails and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, {
      base_url: "https://api.gitbook.com.evil.example.com/v1",
    });
    await expect(createGitBookPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(/base_url/);
    expect(server.authHeaders).toEqual([]);
  });

  it("the config cannot enable loopback http", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, { allowLoopbackHttp: true });
    await expect(createGitBookPublisher().publish(ctx)).rejects.toThrow("base_url must be https");
    expect(server.authHeaders).toEqual([]);
  });

  it("isGitBookAppUrl wants https on the GitBook app host", () => {
    expect(isGitBookAppUrl("https://app.gitbook.com/s/abc/page")).toBe(true);
    expect(isGitBookAppUrl("http://app.gitbook.com/s/abc")).toBe(false);
    expect(isGitBookAppUrl("https://evil.example.com/s/abc")).toBe(false);
    expect(isGitBookAppUrl("https://app.gitbook.com.evil.example.com/x")).toBe(false);
    expect(isGitBookAppUrl("https://u" + ":p@app.gitbook.com/x")).toBe(false);
    expect(isGitBookAppUrl("https://app.gitbook.com:8443/x")).toBe(false);
    expect(isGitBookAppUrl(42)).toBe(false);
  });
});

describe("gitbook publisher: redirects", () => {
  it("does not follow a redirect on the change request create, so the token stays on the first host", async () => {
    const other = await startFakeGitBook(TOKEN);
    try {
      server.redirectWritesTo = `${other.baseUrl}/spaces/${SPACE}/change-requests`;
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await expect(
        createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow(/POST .* failed/);
      expect(other.authHeaders).toEqual([]);
      expect(other.changeRequests.size).toBe(0);
    } finally {
      await other.close();
    }
  });

  it("does not follow a redirect on a content batch either, and archives the draft", async () => {
    const other = await startFakeGitBook(TOKEN);
    try {
      server.redirectWritesTo = `${other.baseUrl}/spaces/${SPACE}/change-requests/cr1/content`;
      server.redirectPathIncludes = "/content";
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await expect(
        createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow(/POST .* failed/);
      expect(other.authHeaders).toEqual([]);
      expect(other.batches).toBe(0);
      expect(server.changeRequests.get("cr1")!.status).toBe("archived");
    } finally {
      await other.close();
    }
  });
});

describe("gitbook publisher: timeouts", () => {
  const FAST = { ...LOOPBACK, apiTimeoutMs: 300, contentTimeoutMs: 300 };

  it("ends a stalled API call with a timeout error and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = [`GET /v1/spaces/${SPACE}/content/pages`];
    const started = Date.now();
    await expect(
      createGitBookPublisher(FAST).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/GET \/spaces\/\{id\}\/content\/pages timed out after 300 ms/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(server.writes).toBe(0);
  });

  it("ends a stalled content batch with a timeout error and archives the draft", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = [`POST /v1/spaces/${SPACE}/change-requests/cr1/content`];
    await expect(
      createGitBookPublisher(FAST).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/POST \/spaces\/\{id\}\/change-requests\/\{id\}\/content timed out/);
    expect(server.pages.size).toBe(0);
    expect(server.changeRequests.get("cr1")!.status).toBe("archived");
  });

  it("keeps the first error when the archive call times out too", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = [
      `POST /v1/spaces/${SPACE}/change-requests/cr1/content`,
      `PATCH /v1/spaces/${SPACE}/change-requests/cr1`,
    ];
    const { log, lines } = capture();
    const started = Date.now();
    await expect(
      createGitBookPublisher(FAST).publish(makeCtx(dir, projection, log)),
    ).rejects.toThrow(/content timed out after 300 ms/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(lines.some((l) => l.includes("could not be archived"))).toBe(true);
  });

  it("a merge that hangs ends in a timeout and leaves the live pages alone", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = [`POST /v1/spaces/${SPACE}/change-requests/cr1/merge`];
    await expect(
      createGitBookPublisher(FAST).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/merge timed out after 300 ms/);
    expect(server.pages.size).toBe(0);
  });
});

describe("gitbook publisher: attachments", () => {
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
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
    expect(server.writes).toBe(0);
  });

  it("refuses a source path that climbs out with ..", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = path.join(dir, "..", "etc-passwd");
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
    expect(server.writes).toBe(0);
  });

  it("refuses a symlink inside the workspace that points outside", async () => {
    const dir = await makeWorkspace();
    const outside = await makeWorkspace();
    const link = path.join(dir, "docs", "checkout", "burned", "link.png");
    await fs.symlink(path.join(outside, "docs", "login", "burned", "step-1.png"), link);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = link;
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
  });

  it("hashes the bytes it read, not the sha256 the projection claims", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const att of projection.documents[0]!.attachments) att.sha256 = "0".repeat(64);
    await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    // A second push with the same wrong claim still sees the page as unchanged.
    const before = server.writes;
    await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(server.writes).toBe(before);

    // And a changed file under the same wrong claim is noticed.
    await fs.writeFile(path.join(dir, "docs", "login", "burned", "step-1.png"), PNG_A);
    const run3 = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(run3.pages.map((p) => p.action)).toEqual(["updated"]);
  });
});

describe("gitbook publisher: attachment reads", () => {
  async function publishWith(
    dir: string,
    edit: (att: { sourcePath: string; sha256: string }) => void,
  ): Promise<unknown> {
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    edit(projection.documents[0]!.attachments[0]);
    return createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
  }

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO without waiting for a writer",
    async () => {
      const dir = await makeWorkspace();
      const fifo = path.join(dir, "docs", "checkout", "burned", "pipe.png");
      await promisify(execFile)("mkfifo", [fifo]);
      const outcome = await Promise.race([
        publishWith(dir, (att) => {
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
      publishWith(dir, (att) => {
        att.sourcePath = link;
      }),
    ).rejects.toThrow(/is a symlink/);
    expect(server.writes).toBe(0);
  });

  it("refuses a file over the size cap before reading it", async () => {
    const dir = await makeWorkspace();
    const big = path.join(dir, "docs", "checkout", "burned", "big.png");
    await fs.writeFile(big, "");
    await fs.truncate(big, MAX_IMAGE_BYTES + 1); // sparse, costs no disk
    await expect(
      publishWith(dir, (att) => {
        att.sourcePath = big;
      }),
    ).rejects.toThrow(/is larger than/);
    expect(server.writes).toBe(0);
  });

  it("reads a file bigger than one read chunk byte for byte, and refuses one that is over a small cap", async () => {
    const dir = await makeWorkspace();
    const data = Buffer.alloc(2 * 1024 * 1024 + 5, 3);
    const file = path.join(dir, "big.bin");
    await fs.writeFile(file, data);
    expect((await readRegularFile(file)).equals(data)).toBe(true);
    expect((await readRegularFile(file, data.byteLength)).byteLength).toBe(data.byteLength);
    await expect(readRegularFile(file, data.byteLength - 1)).rejects.toThrow(/is larger than/);
  });
});

describe("gitbook publisher: size caps", () => {
  const media = (name: string): AdfNode => ({
    type: "mediaSingle",
    content: [{ type: "media", attrs: { type: "file", id: "", collection: "", alt: name } }],
  });

  function projectionOf(
    content: AdfNode[],
    attachments: AdfProjection["documents"][0]["attachments"],
  ) {
    return {
      schema: "docsxai/adf-projection@1",
      mode: "single",
      warnings: [],
      documents: [
        {
          section: "project",
          title: "Big",
          adf: { version: 1, type: "doc", content },
          attachments,
        },
      ],
    } as AdfProjection;
  }

  it("sends at most 4 MiB of screenshots in one batch and captions the rest", async () => {
    const dir = await makeWorkspace();
    const names = Array.from({ length: 8 }, (_, i) => `shot-${i}.png`);
    for (const [i, name] of names.entries()) {
      await fs.writeFile(path.join(dir, name), Buffer.alloc(600_000, i + 1));
    }
    const projection = projectionOf(
      names.map(media),
      names.map((fileName) => ({
        fileName,
        sourcePath: path.join(dir, fileName),
        sha256: "0".repeat(64),
      })),
    );
    const run = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(MAX_PAGE_IMAGE_BYTES).toBe(4 * 1024 * 1024);
    // 6 x 600,000 bytes fit under 4 MiB, the 7th would not
    expect(server.files.map((f) => f.name)).toEqual(names.slice(0, 6));
    const left = run.warnings.filter((w) => w.includes(`at most ${MAX_PAGE_IMAGE_BYTES} bytes`));
    expect(left).toHaveLength(2);
    const markdown = server.pages.get(run.pages[0]!.id)!.markdown;
    expect(markdown.match(/\*Screenshot not uploaded: /g)).toHaveLength(2);
  });

  it("refuses a page whose markdown is over 1 MiB, and writes nothing", async () => {
    const dir = await makeWorkspace();
    const text = "a".repeat(MAX_PAGE_MARKDOWN_BYTES + 1);
    const projection = projectionOf([{ type: "paragraph", content: [{ type: "text", text }] }], []);
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/section "project" renders to \d+ bytes of markdown, over the 1048576 byte/);
    expect(server.writes).toBe(0);
    expect(server.changeRequests.size).toBe(0);
  });

  it("caps the read of one screenshot at 4 MiB", () => {
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("gitbook publisher: names", () => {
  it.each([".", "..", "...", "-.-", " .. "])("safeName refuses the all-dot name %j", (raw) => {
    expect(() => safeName(raw)).toThrow(/not a usable name/);
  });

  it("safeName keeps ordinary names, dots inside included", () => {
    expect(safeName("a..b")).toBe("a..b");
    expect(safeName("checkout--step-1.png")).toBe("checkout--step-1.png");
    expect(safeName("")).toBe("item");
  });

  it("pageSlug gives lower case words, at most 100 characters, never empty", () => {
    expect(pageSlug("Checkout_Flow.v2")).toBe("checkout-flow-v2");
    expect(pageSlug("...")).toBe("page");
    expect(pageSlug("x".repeat(300))).toHaveLength(100);
  });
});

describe("gitbook publisher: manifest page", () => {
  const goodSha = "a".repeat(64);

  it("reads the manifest back through the fence GitBook may rewrite", () => {
    const manifest = emptyManifest();
    manifest.pages["index"] = { pageId: "pg1", sha256: goodSha };
    const markdown = manifestToMarkdown(manifest);
    expect(parseManifestMarkdown(markdown, () => {}, "t").pages["index"]).toEqual({
      pageId: "pg1",
      sha256: goodSha,
    });
    const rewritten = markdown.replace("```json", "```").replaceAll("\n", "\r\n");
    expect(parseManifestMarkdown(rewritten, () => {}, "t").pages["index"]?.pageId).toBe("pg1");
    const framed = withTitle(MANIFEST_TITLE, markdown);
    expect(parseManifestMarkdown(framed, () => {}, "t").pages["index"]?.pageId).toBe("pg1");
  });

  it("repairs a damaged hash without losing the page id, and warns once per entry", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    writeManifest({
      schema: MANIFEST_SCHEMA,
      pages: { index: { pageId: run1.pages[0]!.id, sha256: "XYZ" } },
    });
    const { log, lines } = capture();
    const writes = server.writes;

    const run2 = await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.pages.size).toBe(2);
    expect(server.writes - writes).toBe(4);
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(1);
  });

  it("does not update a page outside the target that the manifest points at", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    server.seedPage({ id: "elsewhere", title: "Somebody else's section" });
    server.seedPage({
      id: "victim",
      title: "Somebody else's page",
      parent: "elsewhere",
      markdown: "not ours",
    });
    writeManifest({
      schema: MANIFEST_SCHEMA,
      pages: { index: { pageId: "victim", sha256: "0".repeat(64) } },
    });

    const { log, lines } = capture();
    const run2 = await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe("victim");
    expect(run2.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    const victim = server.pages.get("victim")!;
    expect(victim.markdown).toBe("not ours");
    expect(victim.title).toBe("Somebody else's page");
    expect(victim.version).toBe(1);
    expect(lines.filter((l) => l.includes("is not a page at the top level"))).toHaveLength(1);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);
  });

  it("does not overwrite the manifest page when a page entry points at it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const manifestId = manifestPage().id;
    writeManifest({
      schema: MANIFEST_SCHEMA,
      pages: { index: { pageId: manifestId, sha256: "0".repeat(64) } },
    });

    const run2 = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe(manifestId);
    expect(manifestPage().id).toBe(manifestId);
    expect(readManifest().pages["index"]!.pageId).toBe(run2.pages[0]!.id);
  });

  it("names at most 20 invalid manifest entries, then counts the rest in one line", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const pages: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) pages[`x-${i}`] = { pageId: "bad/id", sha256: goodSha };
    server.seedPage({
      title: MANIFEST_TITLE,
      markdown: manifestToMarkdown({ schema: MANIFEST_SCHEMA, pages } as unknown as Manifest),
    });
    const { log, lines } = capture();
    await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(20);
    expect(lines.filter((l) => l.includes("5 more manifest entries are not valid"))).toHaveLength(
      1,
    );
  });

  it("refuses a manifest page it cannot read, so a push never starts over", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const fenced = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
    for (const markdown of [
      "edited by hand",
      "```json\n{not json\n```",
      fenced({ schema: MANIFEST_SCHEMA, pages: [1] }),
      fenced({ schema: "other@1", pages: {} }),
    ]) {
      server.pages.clear();
      server.seedPage({ title: MANIFEST_TITLE, markdown });
      await expect(
        createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow("is not a docsxai manifest");
      expect(server.writes).toBe(0);
    }
  });

  it("keeps a __proto__ key in the manifest from touching prototypes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const entry = JSON.stringify({ pageId: "x", sha256: goodSha });
    server.seedPage({
      title: MANIFEST_TITLE,
      markdown: `\`\`\`json\n{"schema":"${MANIFEST_SCHEMA}","pages":{"__proto__":${entry}}}\n\`\`\``,
    });
    await createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(({} as Record<string, unknown>)["pageId"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["sha256"]).toBeUndefined();
  });

  it("refuses two manifest pages side by side, and a pin picks one", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const empty = manifestToMarkdown(emptyManifest());
    server.seedPage({ id: "m1", title: MANIFEST_TITLE, markdown: empty });
    server.seedPage({ id: "m2", title: MANIFEST_TITLE, markdown: empty });
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/2 pages titled "docsxai manifest"/);
    expect(server.writes).toBe(0);

    const run = await createGitBookPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log, { manifest_page_id: "m2" }),
    );
    expect(run.pages.map((p) => p.action)).toEqual(["created"]);
    expect(server.pages.get("m2")!.markdown).toContain(run.pages[0]!.id);
    expect(server.pages.get("m1")!.markdown).toBe(empty);
  });

  it("refuses a pinned manifest page that is not there", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      createGitBookPublisher(LOOPBACK).publish(
        makeCtx(dir, projection, capture().log, { manifest_page_id: "nope" }),
      ),
    ).rejects.toThrow("is not a page at the top level");
    expect(server.writes).toBe(0);
  });
});

describe("gitbook client: bounded responses", () => {
  it("refuses a body over the limit, with or without a content-length", async () => {
    await expect(readBoundedText(new Response("x".repeat(100)), 10)).rejects.toThrow(
      /over 10 bytes/,
    );
    await expect(
      readBoundedText(new Response("x".repeat(100), { headers: { "content-length": "100" } }), 10),
    ).rejects.toThrow(/over 10 bytes/);
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

  it("refuses a page listing over 8 MiB and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.listPadding = MAX_RESPONSE_BYTES + 1;
    await expect(
      createGitBookPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/over 8388608 bytes/);
    expect(server.writes).toBe(0);
  });

  it("reports a connection failure as an error that names the call", async () => {
    const client = new GitBookClient("http://127.0.0.1:1/v1", "t", (s) => s, LOOPBACK);
    await expect(client.listPages("s")).rejects.toThrow(/gitbook: GET .* failed/);
  });
});

describe("adf to markdown", () => {
  const none = () => undefined;

  it("renders the engine's markdown subset", () => {
    const source = [
      "Use **bold**, *em* and `code` with a [link](https://example.com/a).",
      "- first\n- second",
      "1. one\n2. two",
      "```\nnpm run build\n```",
    ].join("\n\n");
    const md = adfToMarkdown({ version: 1, type: "doc", content: markdownToAdf(source) }, none);
    expect(md).toContain("**bold**");
    expect(md).toContain("*em*");
    expect(md).toContain("`code`");
    expect(md).toContain("[link](https://example.com/a)");
    expect(md).toContain("- first\n- second");
    expect(md).toContain("1. one\n2. two");
    expect(md).toContain("```\nnpm run build\n```");
  });

  it("escapes markup and GitBook tags in text, and drops a link that is not http, https or mailto", () => {
    const doc: AdfDoc = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: '<script>alert("x")</script> {% hint %} a_b | c' },
            {
              type: "text",
              text: "bad",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
            {
              type: "text",
              text: "paren",
              marks: [{ type: "link", attrs: { href: "https://example.com/a(b)" } }],
            },
            {
              type: "text",
              text: "good",
              marks: [{ type: "link", attrs: { href: "mailto:docs@example.com" } }],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(doc, none);
    expect(md).not.toContain("<script>");
    expect(md).not.toContain("javascript:");
    expect(md).not.toContain("example.com/a(b)");
    expect(md).toContain("\\<script\\>");
    expect(md).toContain("\\{% hint %\\}");
    expect(md).toContain("a\\_b \\| c");
    expect(md).toContain("[good](mailto:docs@example.com)");
  });

  it("fences code with more backticks than the code holds", () => {
    const doc: AdfDoc = {
      version: 1,
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "a ``` b" }] }],
    };
    expect(adfToMarkdown(doc, none)).toBe("````\na ``` b\n````");
  });

  it("links a resolved screenshot and captions one that was not uploaded", () => {
    const doc: AdfDoc = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [{ type: "media", attrs: { alt: "login--step-1.png" } }],
        },
      ],
    };
    expect(
      adfToMarkdown(doc, (name) => (name === "login--step-1.png" ? "./ref-0" : undefined)),
    ).toBe("![login--step-1.png](./ref-0)");
    expect(adfToMarkdown(doc, none)).toBe("*Screenshot not uploaded: login--step-1.png*");
  });

  it("puts the title in JSON-quoted frontmatter", () => {
    expect(withTitle('A "quoted": title', "Body")).toBe(
      '---\ntitle: "A \\"quoted\\": title"\n---\n\nBody\n',
    );
  });
});
