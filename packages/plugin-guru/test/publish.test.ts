// Publisher suite against the in-process fake Guru server: idempotent re-push (zero writes),
// in-place card updates, images attached, the credentials absent from every log line and error,
// the exact capability declaration, the base URL allowlist, redirect refusal on writes, bounded
// responses, workspace-confined attachment reads, and the load through the real plugin runtime.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdfDoc,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  markdownToAdf,
  projectDocPackToAdf,
  resolvePlugins,
} from "@docsxai/engine";
import { adfToHtml, escapeHtml, safeName } from "../src/adf-html.js";
import { parseConfig } from "../src/config.js";
import {
  GuruClient,
  MAX_RESPONSE_BYTES,
  assertGuruBaseUrl,
  isAttachmentUrl,
  readBoundedText,
} from "../src/guru-client.js";
import {
  MANIFEST_SCHEMA,
  MANIFEST_TITLE,
  type Manifest,
  cardUrl,
  emptyManifest,
  isGuruCardUrl,
  manifestToHtml,
  parseManifestHtml,
} from "../src/manifest.js";
import { createGuruPublisher } from "../src/publisher.js";
import { MAX_IMAGE_BYTES } from "../src/read-file.js";
import { type FakeCard, type FakeGuru, startFakeGuru } from "./fake-guru.js";

/** The fake Guru server is plain http on loopback, which the publisher refuses unless told otherwise. */
const LOOPBACK = { allowLoopbackHttp: true } as const;

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "gurutok-9f8e7d6c-5b4a-4321-abcd-0123456789ab";
const EMAIL = "docs.bot@example.com";
const COLLECTION = "coll-1";

const tempDirs: string[] = [];
let server: FakeGuru;

beforeAll(() => {
  process.env["GURU_USER_TOKEN"] = TOKEN;
  process.env["GURU_USER_EMAIL"] = EMAIL;
});
afterAll(async () => {
  delete process.env["GURU_USER_TOKEN"];
  delete process.env["GURU_USER_EMAIL"];
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});
beforeEach(async () => {
  server = await startFakeGuru(EMAIL, TOKEN);
});
afterEach(async () => {
  await server.close();
});

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

/** Two flows, one documented step each: enough for both modes and for image attachment. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-guru-test-"));
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
    config: { collection_id: COLLECTION, base_url: server.baseUrl, ...extraConfig },
    secretsEnv: { token: "GURU_USER_TOKEN", email: "GURU_USER_EMAIL" },
    log,
  };
}

function cardsTitled(title: string): FakeCard[] {
  return [...server.cards.values()].filter((c) => c.preferredPhrase === title);
}

function manifestCard(): FakeCard {
  const found = cardsTitled(MANIFEST_TITLE);
  expect(found).toHaveLength(1);
  return found[0]!;
}

/** Puts a manifest card straight into the fake, as an earlier push would have left it. */
function seedManifestCard(content: string, collection = COLLECTION, id = "seeded-manifest") {
  server.cards.set(id, {
    id,
    preferredPhrase: MANIFEST_TITLE,
    content,
    slug: id,
    version: 1,
    shareStatus: "TEAM",
    collection: { id: collection },
    tags: [],
  });
}

const PAGE_TREE = { mode: "page-tree" as const, title: "Shop docs" };

describe("guru publisher: idempotency (fake Guru)", () => {
  it("pushes a single-mode pack twice: the second push performs zero writes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createGuruPublisher(LOOPBACK);
    const { log } = capture();

    const run1 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run1.ok).toBe(true);
    expect(run1.target).toBe(`guru:collection/${COLLECTION}`);
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([["project", "created"]]);
    expect(run1.pages[0]!.url).toMatch(/^https:\/\/app\.getguru\.com\/card\//);
    expect(server.writes).toBe(4); // 2 images + 1 card + the manifest card
    expect(server.cards.size).toBe(2);
    expect(server.uploads.map((u) => u.filename).sort()).toEqual([
      "checkout--step-1.png",
      "login--step-1.png",
    ]);

    const writesAfterRun1 = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(run2.pages[0]!.url).toBe(run1.pages[0]!.url);
    expect(server.writes).toBe(writesAfterRun1);
    expect(server.cards.size).toBe(2);
  });

  it("updates the same card in place, and a repeat of the changed push writes nothing", async () => {
    const dir = await makeWorkspace();
    const publisher = createGuruPublisher(LOOPBACK);
    const { log } = capture();

    const first = await projectDocPackToAdf({ workspaceDir: dir, options: PAGE_TREE });
    const run1 = await publisher.publish(makeCtx(dir, first, log, { title_prefix: "[Docs] " }));
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "created"],
      ["checkout", "created"],
      ["login", "created"],
    ]);
    expect(cardsTitled("[Docs] Shop docs")).toHaveLength(1);
    expect(server.writes).toBe(6); // 2 images + 3 cards + the manifest card
    expect(server.cards.size).toBe(4);
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
    expect(server.writes - baseline).toBe(2); // the checkout card + the manifest card
    expect(server.cards.size).toBe(4);
    expect(server.cards.get(checkoutId)!.content).toContain("with new copy.");
    expect(server.cards.get(checkoutId)!.version).toBe(2);

    const settled = server.writes;
    const run3 = await publisher.publish(makeCtx(dir, second, log, { title_prefix: "[Docs] " }));
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(server.writes).toBe(settled);
  });

  it("a changed screenshot uploads that image again and updates its page only", async () => {
    const dir = await makeWorkspace();
    const publisher = createGuruPublisher(LOOPBACK);
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
    expect(server.writes - baseline).toBe(3); // one image, the card, the manifest card
    expect(server.uploads).toHaveLength(3);
    const newest = server.uploads[2]!;
    expect(newest.filename).toBe("login--step-1.png");
    expect(server.cards.get(run2.pages[0]!.id)!.content).toContain(newest.link);
  });

  it("force writes every card and image again, updating cards in place", async () => {
    const dir = await makeWorkspace();
    const publisher = createGuruPublisher(LOOPBACK);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publisher.publish(makeCtx(dir, projection, capture().log));
    const baseline = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, capture().log, { force: true }));
    expect(run2.pages.map((p) => p.action)).toEqual(["updated"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.writes - baseline).toBe(4); // 2 images, the card, the manifest card
    expect(server.cards.size).toBe(2);
  });

  it("keeps the tags a card carries when it updates it", async () => {
    const dir = await makeWorkspace();
    const publisher = createGuruPublisher(LOOPBACK);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publisher.publish(makeCtx(dir, projection, capture().log));
    const tags = [{ id: "t-1", value: "keep-me" }];
    server.cards.get(run1.pages[0]!.id)!.tags = tags;

    await fs.writeFile(path.join(dir, "docs", "checkout", "step-1.md"), "New copy.\n", "utf8");
    const changed = await projectDocPackToAdf({ workspaceDir: dir });
    await publisher.publish(makeCtx(dir, changed, capture().log));
    expect(server.cards.get(run1.pages[0]!.id)!.tags).toEqual(tags);
  });

  it("creates a card again when it was deleted in Guru, once the push is forced", async () => {
    const dir = await makeWorkspace();
    const publisher = createGuruPublisher(LOOPBACK);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await publisher.publish(makeCtx(dir, projection, capture().log));
    server.cards.delete(run1.pages[0]!.id);

    const baseline = server.writes;
    const quiet = await publisher.publish(makeCtx(dir, projection, capture().log));
    expect(quiet.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(baseline);

    const forced = await publisher.publish(
      makeCtx(dir, projection, capture().log, { force: true }),
    );
    expect(forced.pages.map((p) => p.action)).toEqual(["created"]);
    expect(forced.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    expect(server.cards.has(forced.pages[0]!.id)).toBe(true);
  });

  it("creates cards with the configured share status, TEAM by default", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(server.cards.get(run.pages[0]!.id)!.shareStatus).toBe("TEAM");
    expect(server.cards.get(run.pages[0]!.id)!.collection.id).toBe(COLLECTION);
    const other = await makeWorkspace();
    const projection2 = await projectDocPackToAdf({ workspaceDir: other });
    const run2 = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(other, projection2, capture().log, {
        collection_id: "coll-2",
        share_status: "PRIVATE",
      }),
    );
    expect(server.cards.get(run2.pages[0]!.id)!.shareStatus).toBe("PRIVATE");
    expect(server.cards.get(run2.pages[0]!.id)!.collection.id).toBe("coll-2");
  });
});

describe("guru publisher: images", () => {
  it("uploads each screenshot byte for byte and embeds the hosted URL in the card", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );

    const byName = new Map(server.uploads.map((u) => [u.filename, u]));
    expect(byName.get("checkout--step-1.png")!.data.equals(PNG_A)).toBe(true);
    expect(byName.get("login--step-1.png")!.data.equals(PNG_B)).toBe(true);
    const content = server.cards.get(run.pages[0]!.id)!.content;
    for (const [name, upload] of byName) {
      expect(upload.link).toMatch(/^https:\/\/content\.api\.getguru\.com\/files\/view\//);
      expect(content).toContain(`<img src="${upload.link}" alt="${name}">`);
    }
    expect(content).toContain("Go to <strong>checkout</strong>.");
    expect(content).not.toContain(dir);
  });

  it("refuses an upload answer that is not a Guru file URL and creates no card", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.uploadLink = "https://evil.example.com/files/view/x";
    await expect(
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow("did not return a Guru file URL");
    expect(server.cards.size).toBe(0);
  });
});

describe("guru publisher: credentials", () => {
  it("sends Basic auth of email and token, and keeps both out of logs, results and Guru", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();

    const result = await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    const basic = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
    expect(server.authHeaders.length).toBeGreaterThan(0);
    expect(server.authHeaders.every((h) => h === basic)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    const secrets = [TOKEN, EMAIL, basic.slice(6)];
    const everything = [
      ...lines,
      JSON.stringify(result),
      JSON.stringify([...server.cards.values()]),
      ...server.uploads.map((u) => u.data.toString("latin1")),
    ].join("\n");
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });

  it("masks token, email and the encoded header when the server echoes them in an error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    server.failEchoingSecrets = true;

    let message = "";
    try {
      await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 500");
    expect(message).toContain("<GURU_USER_TOKEN>");
    expect(message).toContain("<GURU_USER_EMAIL>");
    expect(message).toContain("<GURU_BASIC_AUTH>");
    for (const text of [message, ...lines]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64"));
    }
  });

  it("names the missing variable, never a value, and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const noToken = makeCtx(dir, projection, capture().log);
    noToken.secretsEnv = { token: "GURU_ABSENT_TOKEN", email: "GURU_USER_EMAIL" };
    await expect(createGuruPublisher(LOOPBACK).publish(noToken)).rejects.toThrow(
      "set GURU_ABSENT_TOKEN",
    );
    const noEmail = makeCtx(dir, projection, capture().log);
    noEmail.secretsEnv = { token: "GURU_USER_TOKEN", email: "GURU_ABSENT_EMAIL" };
    await expect(createGuruPublisher(LOOPBACK).publish(noEmail)).rejects.toThrow(
      "set GURU_ABSENT_EMAIL",
    );
    expect(server.requests).toEqual([]);
  });

  it("requires a collection and a valid share status", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.config = { base_url: server.baseUrl };
    await expect(createGuruPublisher(LOOPBACK).publish(ctx)).rejects.toThrow("collection_id");
    expect(() => parseConfig({ collection_id: "c", share_status: "PUBLIC" })).toThrow(
      /share_status/,
    );
    expect(() => parseConfig({ collection_id: "../c" })).toThrow(/collection_id/);
    expect(() => parseConfig({ collection_id: "c", manifest_card_id: "a/b" })).toThrow(
      /manifest_card_id/,
    );
  });
});

describe("guru plugin: manifest and runtime", () => {
  it("declares exactly one capability, the Guru API host, and stays private", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      private?: boolean;
      docsxai: { namespace: string; kinds: string[]; capabilities: string[]; trust: string };
    };
    expect(pkg.docsxai.capabilities).toEqual(["egress:api.getguru.com"]);
    expect(pkg.docsxai.namespace).toBe("guru");
    expect(pkg.docsxai.kinds).toEqual(["publisher"]);
    expect(pkg.private).toBe(true);
  });

  it("resolvePlugins loads guru:push from the built package and it refuses a non-Guru endpoint", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:api.getguru.com"],
    });
    const record = registry.pluginsInfo("guru");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "guru:push" }]);

    // The loaded publisher takes no test option, so it refuses the plain-http fake server.
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      registry.getPublisher("guru:push").publish(makeCtx(dir, projection, capture().log)),
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
    expect(registry.pluginsInfo("guru")?.status).toBe("disabled-by-capability-mismatch");
  });
});

describe("guru publisher: base_url", () => {
  it.each([
    "https://api.getguru.com/api/v1",
    "https://api.getguru.com/api/v1//",
    "https://api.getguru.com:443/api/v1",
  ])("accepts %s and normalises it", (url) => {
    expect(assertGuruBaseUrl(url)).toBe("https://api.getguru.com/api/v1");
  });

  it.each([
    "http://api.getguru.com/api/v1",
    "https://evil.example.com/api/v1",
    "https://api.getguru.com.evil.example.com/api/v1",
    "https://evil.example.com/api.getguru.com/api/v1",
    "https://user" + ":pw@api.getguru.com/api/v1",
    "https://app.getguru.com/api/v1",
    "https://content.api.getguru.com/api/v1",
    "https://api.getguru.com:8443/api/v1",
    "https://api.getguru.com/api/v2",
    "https://api.getguru.com/",
    "https://api.getguru.com/api/v1/cards",
    "https://api.getguru.com/api/v1?x=1",
    "https://api.getguru.com/api/v1#x",
    "ftp://api.getguru.com/api/v1",
    "api.getguru.com/api/v1",
    "http://127.0.0.1:4000/api/v1",
    "http://localhost/api/v1",
  ])("refuses %s", (url) => {
    expect(() => assertGuruBaseUrl(url)).toThrow(/base_url/);
  });

  it("takes loopback http only under the explicit test option", () => {
    expect(assertGuruBaseUrl("http://127.0.0.1:4000/api/v1", LOOPBACK)).toBe(
      "http://127.0.0.1:4000/api/v1",
    );
    expect(() => assertGuruBaseUrl("http://evil.example.com/api/v1", LOOPBACK)).toThrow(/base_url/);
    expect(() => assertGuruBaseUrl("https://127.0.0.1/api/v1", LOOPBACK)).toThrow(/base_url/);
  });

  it("parseConfig applies the same rule, and the default is the public API", () => {
    expect(parseConfig({ collection_id: "c" }).base_url).toBe("https://api.getguru.com/api/v1");
    expect(() => parseConfig({ collection_id: "c", base_url: "http://x.test/api/v1" })).toThrow(
      /base_url/,
    );
  });

  it("the client refuses a host outside the allowlist before any request", () => {
    expect(() => new GuruClient("https://evil.example.com/api/v1", "e", "t", (s) => s)).toThrow(
      /base_url/,
    );
  });

  it("publish with an off-list endpoint fails and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, {
      base_url: "https://api.getguru.com.evil.example.com/api/v1",
    });
    await expect(createGuruPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(/base_url/);
    expect(server.authHeaders).toEqual([]);
  });

  it("the config cannot enable loopback http", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, { allowLoopbackHttp: true });
    await expect(createGuruPublisher().publish(ctx)).rejects.toThrow("base_url must be https");
    expect(server.authHeaders).toEqual([]);
  });
});

describe("guru publisher: redirects", () => {
  it("does not follow a redirect on an upload, so the credentials stay on the first host", async () => {
    const other = await startFakeGuru(EMAIL, TOKEN);
    try {
      server.redirectWritesTo = `${other.baseUrl}/attachments/upload`;
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await expect(
        createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow(/POST .* failed/);
      expect(other.authHeaders).toEqual([]);
      expect(other.uploads).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it("does not follow a redirect on a card update either", async () => {
    const other = await startFakeGuru(EMAIL, TOKEN);
    try {
      const dir = await makeWorkspace();
      const publisher = createGuruPublisher(LOOPBACK);
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await publisher.publish(makeCtx(dir, projection, capture().log));

      await fs.writeFile(path.join(dir, "docs", "checkout", "step-1.md"), "New copy.\n", "utf8");
      const changed = await projectDocPackToAdf({ workspaceDir: dir });
      server.redirectWritesTo = `${other.baseUrl}/cards/card-1/extended`;
      await expect(publisher.publish(makeCtx(dir, changed, capture().log))).rejects.toThrow(
        /PUT .* failed/,
      );
      expect(other.authHeaders).toEqual([]);
      expect(other.cards.size).toBe(0);
    } finally {
      await other.close();
    }
  });
});

describe("guru publisher: timeouts", () => {
  const FAST = { ...LOOPBACK, apiTimeoutMs: 300, uploadTimeoutMs: 300 };

  it("ends a stalled API call with a timeout error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = ["GET /api/v1/search/query"];
    const started = Date.now();
    await expect(
      createGuruPublisher(FAST).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/GET \/search\/query timed out after 300 ms/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(server.writes).toBe(0);
  });

  it("ends a stalled upload with a timeout error and writes no card", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = ["POST /api/v1/attachments/upload"];
    await expect(
      createGuruPublisher(FAST).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/POST \/attachments\/upload timed out/);
    expect(server.cards.size).toBe(0);
  });

  it("a manifest write that hangs ends in a timeout and keeps the first error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    // Every card create stalls: the page card times out, then the manifest write does too.
    server.stall = ["POST /api/v1/cards/extended"];
    const { log, lines } = capture();
    const started = Date.now();
    await expect(createGuruPublisher(FAST).publish(makeCtx(dir, projection, log))).rejects.toThrow(
      /POST \/cards\/extended timed out after 300 ms/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(lines.some((l) => l.includes("manifest write failed"))).toBe(true);
    expect(server.cards.size).toBe(0);
  });

  it("a manifest write that times out fails a push that had no other error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createGuruPublisher(FAST);
    await publisher.publish(makeCtx(dir, projection, capture().log));
    const manifestId = manifestCard().id;

    await fs.writeFile(path.join(dir, "docs", "checkout", "step-1.md"), "New copy.\n", "utf8");
    const changed = await projectDocPackToAdf({ workspaceDir: dir });
    server.stall = [`PUT /api/v1/cards/${manifestId}/extended`];
    await expect(publisher.publish(makeCtx(dir, changed, capture().log))).rejects.toThrow(
      /PUT \/cards\/\{id\}\/extended timed out after 300 ms/,
    );
  });
});

describe("guru publisher: attachments", () => {
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
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
    expect(server.writes).toBe(0);
  });

  it("refuses a source path that climbs out with ..", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = path.join(dir, "..", "etc-passwd");
    await expect(
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
  });

  it("refuses a symlink inside the workspace that points outside", async () => {
    const dir = await makeWorkspace();
    const outside = await makeWorkspace();
    const link = path.join(dir, "docs", "checkout", "burned", "link.png");
    await fs.symlink(path.join(outside, "docs", "login", "burned", "step-1.png"), link);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = link;
    await expect(
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
  });

  it("hashes the bytes it read, not the sha256 the projection claims", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const att of projection.documents[0]!.attachments) att.sha256 = "0".repeat(64);
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const manifest = parseManifestHtml(manifestCard().content, () => {}, "test");
    expect(manifest.images["login--step-1.png"]!.sha256).toBe(
      createHash("sha256").update(PNG_B).digest("hex"),
    );
    // A second push with the same wrong claim still sees the images as unchanged.
    const before = server.writes;
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(server.writes).toBe(before);
  });
});

describe("guru publisher: attachment reads", () => {
  async function publishWith(
    dir: string,
    edit: (att: { sourcePath: string; sha256: string }) => void,
  ): Promise<unknown> {
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    edit(projection.documents[0]!.attachments[0]);
    return createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
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

  it("reads a file bigger than one read chunk byte for byte", async () => {
    const dir = await makeWorkspace();
    const data = Buffer.alloc(2 * 1024 * 1024 + 5, 3);
    await fs.writeFile(path.join(dir, "docs", "checkout", "burned", "step-1.png"), data);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const upload = server.uploads.find((u) => u.filename === "checkout--step-1.png")!;
    expect(upload.data.equals(data)).toBe(true);
  });
});

describe("guru publisher: names", () => {
  it.each([".", "..", "...", "-.-", " .. "])("safeName refuses the all-dot name %j", (raw) => {
    expect(() => safeName(raw)).toThrow(/not a usable name/);
  });

  it("safeName keeps ordinary names, dots inside included", () => {
    expect(safeName("a..b")).toBe("a..b");
    expect(safeName("checkout--step-1.png")).toBe("checkout--step-1.png");
    expect(safeName("")).toBe("item");
  });
});

describe("guru publisher: manifest card", () => {
  const goodImage = {
    sha256: "a".repeat(64),
    size: 1,
    link: "https://content.api.getguru.com/files/view/x",
  };

  it("isGuruCardUrl wants https on the Guru app host, and cardUrl builds one from a slug", () => {
    expect(isGuruCardUrl("https://app.getguru.com/card/abc/Title")).toBe(true);
    expect(isGuruCardUrl("http://app.getguru.com/card/abc")).toBe(false);
    expect(isGuruCardUrl("https://evil.example.com/card/abc")).toBe(false);
    expect(isGuruCardUrl("https://app.getguru.com.evil.example.com/x")).toBe(false);
    expect(isGuruCardUrl("https://u" + ":p@app.getguru.com/x")).toBe(false);
    expect(isGuruCardUrl(42)).toBe(false);
    expect(cardUrl("abc/My-Title")).toBe("https://app.getguru.com/card/abc/My-Title");
    expect(cardUrl("../x")).toBeUndefined();
    expect(cardUrl("a b")).toBeUndefined();
    expect(cardUrl(undefined)).toBeUndefined();
  });

  it("reads the manifest back through the markup Guru may wrap around it", () => {
    const manifest = emptyManifest();
    manifest.images["a.png"] = goodImage;
    const html = manifestToHtml(manifest);
    expect(parseManifestHtml(html, () => {}, "t").images["a.png"]).toEqual(goodImage);
    const wrapped = html
      .replace("<pre>", '<pre class="x"><code>')
      .replace("</pre>", "</code></pre>")
      .replaceAll("&quot;", "&#34;");
    expect(parseManifestHtml(wrapped, () => {}, "t").images["a.png"]).toEqual(goodImage);
  });

  it("repairs damaged entries without losing a card id, and warns once per entry", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    const run1 = await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    const good = parseManifestHtml(manifestCard().content, () => {}, "t");
    const writes = server.writes;

    const damaged = {
      schema: MANIFEST_SCHEMA,
      pages: { index: { ...good.pages["index"]!, url: "https://evil.example.com/phish" } },
      images: {
        "login--step-1.png": { ...good.images["login--step-1.png"]!, sha256: "XYZ" },
        "checkout--step-1.png": { ...good.images["checkout--step-1.png"]!, size: -1 },
      },
    } as unknown as Manifest;
    manifestCard().content = manifestToHtml(damaged);
    lines.length = 0;

    const run2 = await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages[0]!.action).toBe("updated");
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(server.cards.size).toBe(2);
    expect(server.writes - writes).toBe(4); // 2 images, the card, the manifest card
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(3);
    expect(JSON.stringify(run2)).not.toContain("evil.example.com");
    expect(manifestCard().content).not.toContain("evil.example.com");
  });

  it("drops a manifest image link outside the exact attachment path shape", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const good = parseManifestHtml(manifestCard().content, () => {}, "t");
    const damaged = emptyManifest();
    damaged.pages["index"] = good.pages["index"]!;
    for (const [name, link] of [
      ["login--step-1.png", "https://content.api.getguru.com/files/view/../x"],
      ["checkout--step-1.png", "https://content.api.getguru.com/files/view/a/b"],
    ] as const) {
      damaged.images[name] = { ...good.images[name]!, link };
    }
    manifestCard().content = manifestToHtml(damaged);
    const { log, lines } = capture();
    const writes = server.writes;
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(2);
    expect(server.writes - writes).toBe(4); // 2 images, the card, the manifest card
  });

  it("does not update a card outside the collection that the manifest points at", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const run1 = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    seedManifestCard("<p>not ours</p>", "other-collection", "victim");
    server.cards.get("victim")!.preferredPhrase = "Somebody else's card";

    const good = parseManifestHtml(manifestCard().content, () => {}, "t");
    const tampered = {
      ...good,
      pages: { index: { ...good.pages["index"]!, cardId: "victim", sha256: "0".repeat(64) } },
    } as unknown as Manifest;
    manifestCard().content = manifestToHtml(tampered);

    const { log, lines } = capture();
    const writes = server.writes;
    const run2 = await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe("victim");
    expect(run2.pages[0]!.id).not.toBe(run1.pages[0]!.id);
    expect(server.writes - writes).toBe(2); // the new card, the manifest card
    const victim = server.cards.get("victim")!;
    expect(victim.content).toBe("<p>not ours</p>");
    expect(victim.collection.id).toBe("other-collection");
    expect(victim.preferredPhrase).toBe("Somebody else's card");
    expect(victim.version).toBe(1);
    expect(lines.filter((l) => l.includes("is not a page in collection"))).toHaveLength(1);
    expect(parseManifestHtml(manifestCard().content, () => {}, "t").pages["index"]!.cardId).toBe(
      run2.pages[0]!.id,
    );
  });

  it("does not overwrite the manifest card when a page entry points at it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const manifestId = manifestCard().id;
    const good = parseManifestHtml(manifestCard().content, () => {}, "t");
    const tampered = {
      ...good,
      pages: { index: { ...good.pages["index"]!, cardId: manifestId, sha256: "0".repeat(64) } },
    } as unknown as Manifest;
    manifestCard().content = manifestToHtml(tampered);

    const run2 = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(run2.pages.map((p) => p.action)).toEqual(["created"]);
    expect(run2.pages[0]!.id).not.toBe(manifestId);
    expect(parseManifestHtml(manifestCard().content, () => {}, "t").pages["index"]!.cardId).toBe(
      run2.pages[0]!.id,
    );
  });

  it("names at most 20 invalid manifest entries, then counts the rest in one line", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const bad = emptyManifest();
    for (let i = 0; i < 25; i++) {
      bad.images[`x-${i}.png`] = { ...goodImage, sha256: "nope" };
    }
    seedManifestCard(manifestToHtml(bad));
    const { log, lines } = capture();
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(lines.filter((l) => l.includes("is not valid, redoing it"))).toHaveLength(20);
    expect(lines.filter((l) => l.includes("5 more manifest entries are not valid"))).toHaveLength(
      1,
    );
  });

  it("refuses a manifest card it cannot read, so a push never starts over", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const content of [
      "<p>edited by hand</p>",
      "<pre>{not json</pre>",
      `<pre>${escapeHtml(JSON.stringify({ schema: MANIFEST_SCHEMA, pages: [1], images: {} }))}</pre>`,
      `<pre>${escapeHtml(JSON.stringify({ schema: "other@1", pages: {}, images: {} }))}</pre>`,
    ]) {
      server.cards.clear();
      seedManifestCard(content);
      await expect(
        createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow("is not a docsxai manifest");
      expect(server.writes).toBe(0);
    }
  });

  it("keeps a __proto__ key in the manifest from touching prototypes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const entry = JSON.stringify({ cardId: "x", sha256: "a".repeat(64) });
    seedManifestCard(
      `<pre>${escapeHtml(`{"schema":"${MANIFEST_SCHEMA}","pages":{"__proto__":${entry}},"images":{}}`)}</pre>`,
    );
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(({} as Record<string, unknown>)["cardId"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["sha256"]).toBeUndefined();
  });

  it("refuses two manifest cards in the collection, and ignores one in another collection", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    seedManifestCard(manifestToHtml(emptyManifest()), "other-collection", "elsewhere");
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(server.cards.get("elsewhere")!.content).toBe(manifestToHtml(emptyManifest()));

    seedManifestCard(manifestToHtml(emptyManifest()), COLLECTION, "duplicate");
    await expect(
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/2 cards titled "docsxai manifest"/);
  });

  it("finds the manifest on a later search page, and a pinned id skips the search", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    seedManifestCard(manifestToHtml(emptyManifest()), "other-collection", "decoy");
    server.cards.get("decoy")!.preferredPhrase = "docsxai manifest (old)";
    await createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const writes = server.writes;

    server.searchPageSize = 1;
    server.requests.length = 0;
    const run2 = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log),
    );
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(writes);
    expect(server.requests.filter((r) => r === "GET /api/v1/search/query").length).toBe(2);

    server.requests.length = 0;
    const pinned = await createGuruPublisher(LOOPBACK).publish(
      makeCtx(dir, projection, capture().log, { manifest_card_id: manifestCard().id }),
    );
    expect(pinned.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.requests.some((r) => r.includes("/search/"))).toBe(false);
    expect(server.writes).toBe(writes);
  });

  it("refuses a pinned manifest card that is missing or in another collection", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      createGuruPublisher(LOOPBACK).publish(
        makeCtx(dir, projection, capture().log, { manifest_card_id: "nope" }),
      ),
    ).rejects.toThrow("does not exist");
    seedManifestCard(manifestToHtml(emptyManifest()), "other-collection", "elsewhere");
    await expect(
      createGuruPublisher(LOOPBACK).publish(
        makeCtx(dir, projection, capture().log, { manifest_card_id: "elsewhere" }),
      ),
    ).rejects.toThrow("is not in collection");
    expect(server.writes).toBe(0);
  });

  it("does not follow a search next page that leaves the Guru API origin", async () => {
    const other = await startFakeGuru(EMAIL, TOKEN);
    try {
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      seedManifestCard(manifestToHtml(emptyManifest()), "other-collection", "decoy-1");
      seedManifestCard(manifestToHtml(emptyManifest()), "other-collection", "decoy-2");
      server.searchPageSize = 1;
      server.searchLinkOverride = `${other.baseUrl}/search/query`;
      await expect(
        createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow("outside the Guru API");
      expect(other.requests).toEqual([]);
      expect(other.authHeaders).toEqual([]);
    } finally {
      await other.close();
    }
  });
});

describe("guru client: bounded responses", () => {
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

  it("refuses a search response over 8 MiB and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    seedManifestCard(" ".repeat(MAX_RESPONSE_BYTES + 1));
    await expect(
      createGuruPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/over 8388608 bytes/);
    expect(server.writes).toBe(0);
  });

  it("refuses a pinned manifest card over 8 MiB", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    seedManifestCard(" ".repeat(MAX_RESPONSE_BYTES + 1));
    await expect(
      createGuruPublisher(LOOPBACK).publish(
        makeCtx(dir, projection, capture().log, { manifest_card_id: "seeded-manifest" }),
      ),
    ).rejects.toThrow(/over 8388608 bytes/);
    expect(server.writes).toBe(0);
  });

  it("isAttachmentUrl wants a file URL on Guru's content host", () => {
    const ok = "https://content.api.getguru.com/files/view/dc360897-7e4c-4565-8c98-57bc6876edb9";
    expect(isAttachmentUrl(ok)).toBe(true);
    expect(isAttachmentUrl("http://content.api.getguru.com/files/view/x")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com.evil.example.com/files/view/x")).toBe(
      false,
    );
    expect(isAttachmentUrl("https://content.api.getguru.com/files/view/x?y=1")).toBe(false);
    expect(isAttachmentUrl("https://u" + ":p@content.api.getguru.com/files/view/x")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com/other/x")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com/files/view/")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com/files/view/a/b")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com/files/view/../x")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com/files/view/%2e%2e")).toBe(false);
    expect(isAttachmentUrl("https://content.api.getguru.com:444/files/view/x")).toBe(false);
    expect(isAttachmentUrl(7)).toBe(false);
  });
});

describe("adf to html", () => {
  it("renders the engine's markdown subset", () => {
    const source = [
      "Use **bold**, *em* and `code` with a [link](https://example.com/a).",
      "- first\n- second",
      "1. one\n2. two",
      "```\nnpm run build\n```",
    ].join("\n\n");
    const html = adfToHtml(
      { version: 1, type: "doc", content: markdownToAdf(source) },
      () => undefined,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com/a">link</a>');
    expect(html).toContain("<ul><li>first</li><li>second</li></ul>");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<pre><code>npm run build</code></pre>");
  });

  it("escapes text and attributes and drops a link that is not http, https or mailto", () => {
    const doc: AdfDoc = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: '<script>alert("x")</script> & more' },
            {
              type: "text",
              text: "bad",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
            {
              type: "text",
              text: "quote",
              marks: [{ type: "link", attrs: { href: 'https://example.com/?a="b"&c=d' } }],
            },
          ],
        },
      ],
    };
    const html = adfToHtml(doc, () => undefined);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(html).toContain('<a href="https://example.com/?a=&quot;b&quot;&amp;c=d">quote</a>');
  });
});
