// Publisher integration suite against the in-process fake Confluence v2 server: idempotent
// re-publish (zero mutations), targeted update on prose change, page-tree nesting, token
// masking, and the load-through-the-REAL-resolvePlugins end-to-end row.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  projectDocPackToAdf,
  resolvePlugins,
} from "@kalebtec/docsxai-engine";
import { createConfluencePublisher } from "../src/publisher.js";
import { type FakeConfluence, startFakeConfluence } from "./fake-confluence.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "secret-api-token-abc123";
const EMAIL = "docs-bot@example.com";

const noopLog: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

const tempDirs: string[] = [];
let server: FakeConfluence;

beforeAll(() => {
  process.env["CONFLUENCE_TOKEN"] = TOKEN;
  process.env["CONFLUENCE_EMAIL"] = EMAIL;
});
afterAll(async () => {
  delete process.env["CONFLUENCE_TOKEN"];
  delete process.env["CONFLUENCE_EMAIL"];
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});
beforeEach(async () => {
  server = await startFakeConfluence();
});
afterEach(async () => {
  await server.close();
});

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

/** Two flows, one documented step each — enough to exercise both modes + attachments. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-confluence-test-"));
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

function makeCtx(
  workspaceDir: string,
  projection: AdfProjection,
  pageMap: Record<string, string> = {},
  extraConfig: Record<string, unknown> = {},
): PublisherContext {
  return {
    workspaceDir,
    projection,
    artifactsDir: workspaceDir,
    config: {
      base_url: server.baseUrl,
      space_id: "777",
      page_map: pageMap,
      ...extraConfig,
    },
    secretsEnv: { token: "CONFLUENCE_TOKEN", email: "CONFLUENCE_EMAIL" },
    log: noopLog,
  };
}

/** Rebuild the `{ section → pageId }` map from a publish result, merged over the prior map. */
function pageMapFrom(
  pages: Array<{ id: string; section?: string }>,
  prior: Record<string, string> = {},
): Record<string, string> {
  const next = { ...prior };
  for (const p of pages) if (p.section) next[p.section] = p.id;
  return next;
}

describe("confluence publisher — idempotency (fake v2 server)", () => {
  it("publishes the same single-mode projection 3×: run 1 creates, runs 2-3 are all 'unchanged' with zero mutations", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createConfluencePublisher();

    const run1 = await publisher.publish(makeCtx(dir, projection));
    expect(run1.ok).toBe(true);
    expect(run1.pages).toHaveLength(1);
    expect(run1.pages[0]!.action).toBe("created");
    expect(run1.pages[0]!.section).toBe("project");
    expect(server.counts.pageCreates).toBe(1);
    expect(server.counts.attachmentUploads).toBe(2);
    const mutationsAfterRun1 = server.totalMutations();
    expect(mutationsAfterRun1).toBeGreaterThan(0);

    const pageMap = pageMapFrom(run1.pages);
    for (let i = 0; i < 2; i++) {
      const rerun = await publisher.publish(makeCtx(dir, projection, pageMap));
      expect(rerun.pages.map((p) => p.action)).toEqual(["unchanged"]);
      expect(rerun.pages[0]!.id).toBe(run1.pages[0]!.id);
      expect(server.totalMutations()).toBe(mutationsAfterRun1); // ZERO new mutations
    }
  });

  it("publishes a page-tree 3×: parent + children created and nested, then all 'unchanged' with zero mutations", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({
      workspaceDir: dir,
      options: { mode: "page-tree", title: "Shop docs" },
    });
    const publisher = createConfluencePublisher();

    const run1 = await publisher.publish(
      makeCtx(dir, projection, {}, { mode: "page-tree", title_prefix: "[Docs] " }),
    );
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "created"],
      ["checkout", "created"],
      ["login", "created"],
    ]);
    const parentId = run1.pages[0]!.id;
    for (const child of run1.pages.slice(1)) {
      expect(server.pages.get(child.id)!.parentId).toBe(parentId);
    }
    expect(server.pages.get(parentId)!.title).toBe("[Docs] Shop docs");
    const mutationsAfterRun1 = server.totalMutations();

    const pageMap = pageMapFrom(run1.pages);
    for (let i = 0; i < 2; i++) {
      const rerun = await publisher.publish(
        makeCtx(dir, projection, pageMap, { mode: "page-tree", title_prefix: "[Docs] " }),
      );
      expect(rerun.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
      expect(server.totalMutations()).toBe(mutationsAfterRun1);
    }
  });

  it("a prose mutation triggers exactly one page update (and no attachment re-uploads)", async () => {
    const dir = await makeWorkspace();
    const publisher = createConfluencePublisher();
    const projection = await projectDocPackToAdf({
      workspaceDir: dir,
      options: { mode: "page-tree" },
    });
    const run1 = await publisher.publish(makeCtx(dir, projection, {}, { mode: "page-tree" }));
    const pageMap = pageMapFrom(run1.pages);
    const baseline = server.totalMutations();

    // Touch one flow's prose only — screenshots stay byte-identical.
    await fs.writeFile(
      path.join(dir, "docs", "checkout", "step-1.md"),
      "Go to **checkout** — now with new copy.\n",
      "utf8",
    );
    const mutated = await projectDocPackToAdf({
      workspaceDir: dir,
      options: { mode: "page-tree" },
    });

    const run2 = await publisher.publish(makeCtx(dir, mutated, pageMap, { mode: "page-tree" }));
    expect(run2.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "unchanged"],
      ["checkout", "updated"],
      ["login", "unchanged"],
    ]);
    expect(server.totalMutations() - baseline).toBe(2); // 1 page update + 1 property bump
    expect(server.counts.attachmentUploads).toBe(2); // unchanged since run 1 (2 flows × 1 png)

    // And the mutated projection is itself stable on the next publish.
    const run3 = await publisher.publish(makeCtx(dir, mutated, pageMap, { mode: "page-tree" }));
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
  });

  it("masks the API token as <CONFLUENCE_TOKEN> in errors even when the server echoes it", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createConfluencePublisher();
    server.failEchoingToken = true;

    let message = "";
    const errLines: string[] = [];
    try {
      await publisher.publish({
        ...makeCtx(dir, projection),
        log: { ...noopLog, error: (m) => errLines.push(m) },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(TOKEN);
    expect(message).toContain("<CONFLUENCE_TOKEN>");
    for (const line of errLines) expect(line).not.toContain(TOKEN);
  });
});

describe("confluence plugin — loads through the real engine plugin runtime", () => {
  it("resolvePlugins({path: <built package>}) loads confluence:push and it publishes end-to-end", async () => {
    const registerJs = path.join(PKG_ROOT, "dist", "register.js");
    await fs.access(registerJs); // built package required — run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:*.atlassian.net"],
    });

    const record = registry.pluginsInfo("confluence");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "confluence:push" }]);

    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = registry.getPublisher("confluence:push");
    const result = await publisher.publish(makeCtx(dir, projection));
    expect(result.ok).toBe(true);
    expect(result.pages[0]!.action).toBe("created");
    expect(server.counts.pageCreates).toBe(1);
  });

  it("is disabled (not loaded) when the egress capability is not operator-enabled", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: [],
    });
    expect(registry.pluginsInfo("confluence")?.status).toBe("disabled-by-capability-mismatch");
  });
});
