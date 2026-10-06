// Publisher suite against the in-process fake Graph server: idempotent re-push (zero writes),
// targeted update on a prose change, images attached, the bearer token absent from every log
// line and error, the exact capability declaration, and the load through the real plugin runtime.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  markdownToAdf,
  projectDocPackToAdf,
  resolvePlugins,
} from "@docsxai/engine";
import { adfToMarkdown } from "../src/adf-markdown.js";
import { MANIFEST_FILE, createSharePointPublisher } from "../src/publisher.js";
import { type FakeGraph, startFakeGraph } from "./fake-graph.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "eyJ0eXAi.fake-graph-bearer-token.sig123";

const tempDirs: string[] = [];
let server: FakeGraph;

beforeAll(() => {
  process.env["SHAREPOINT_TOKEN"] = TOKEN;
});
afterAll(async () => {
  delete process.env["SHAREPOINT_TOKEN"];
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});
beforeEach(async () => {
  server = await startFakeGraph(TOKEN);
});
afterEach(async () => {
  await server.close();
});

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

/** Two flows, one documented step each: enough for both modes and for image attachment. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-sharepoint-test-"));
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
    config: { drive_id: "b!drive-1", graph_base_url: server.baseUrl, ...extraConfig },
    secretsEnv: { token: "SHAREPOINT_TOKEN" },
    log,
  };
}

function text(file: string): string {
  return server.files.get(file)!.data.toString("utf8");
}

describe("sharepoint publisher: idempotency (fake Graph)", () => {
  it("pushes a single-mode pack twice: the second push performs zero writes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createSharePointPublisher();
    const { log } = capture();

    const run1 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run1.ok).toBe(true);
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([["project", "created"]]);
    expect(run1.pages[0]!.url).toContain("docsxai/index.md");
    expect(server.writes).toBe(4); // 2 images + index.md + manifest
    expect([...server.files.keys()].sort()).toEqual([
      `docsxai/${MANIFEST_FILE}`,
      "docsxai/images/checkout--step-1.png",
      "docsxai/images/login--step-1.png",
      "docsxai/index.md",
    ]);

    const writesAfterRun1 = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, log));
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(run2.pages[0]!.id).toBe(run1.pages[0]!.id);
    expect(run2.pages[0]!.url).toBe(run1.pages[0]!.url);
    expect(server.writes).toBe(writesAfterRun1);
  });

  it("a prose change in one flow rewrites that page and the manifest only", async () => {
    const dir = await makeWorkspace();
    const publisher = createSharePointPublisher();
    const options = { mode: "page-tree" as const, title: "Shop docs" };
    const { log } = capture();

    const first = await projectDocPackToAdf({ workspaceDir: dir, options });
    const run1 = await publisher.publish(makeCtx(dir, first, log, { title_prefix: "[Docs] " }));
    expect(run1.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "created"],
      ["checkout", "created"],
      ["login", "created"],
    ]);
    expect(text("docsxai/index.md")).toMatch(/^# \[Docs\] Shop docs\n/);
    const baseline = server.writes;
    expect(baseline).toBe(6); // 2 images + 3 pages + manifest

    await fs.writeFile(
      path.join(dir, "docs", "checkout", "step-1.md"),
      "Go to **checkout** with new copy.\n",
      "utf8",
    );
    const second = await projectDocPackToAdf({ workspaceDir: dir, options });
    const run2 = await publisher.publish(makeCtx(dir, second, log, { title_prefix: "[Docs] " }));
    expect(run2.pages.map((p) => [p.section, p.action])).toEqual([
      ["project", "unchanged"],
      ["checkout", "updated"],
      ["login", "unchanged"],
    ]);
    expect(server.writes - baseline).toBe(2); // checkout.md + manifest
    expect(text("docsxai/checkout.md")).toContain("with new copy.");

    const settled = server.writes;
    const run3 = await publisher.publish(makeCtx(dir, second, log, { title_prefix: "[Docs] " }));
    expect(run3.pages.map((p) => p.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(server.writes).toBe(settled);
  });

  it("a changed screenshot re-uploads that image and its page only", async () => {
    const dir = await makeWorkspace();
    const publisher = createSharePointPublisher();
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
    expect(server.writes - baseline).toBe(2); // one image + manifest, index.md bytes are identical
  });
});

describe("sharepoint publisher: images", () => {
  it("uploads each screenshot byte for byte and links it from the page", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createSharePointPublisher().publish(makeCtx(dir, projection, capture().log));

    expect(server.files.get("docsxai/images/checkout--step-1.png")!.data.equals(PNG_A)).toBe(true);
    expect(server.files.get("docsxai/images/login--step-1.png")!.data.equals(PNG_B)).toBe(true);
    expect(server.files.get("docsxai/images/login--step-1.png")!.contentType).toBe("image/png");
    const page = text("docsxai/index.md");
    expect(page).toContain("![checkout--step-1.png](images/checkout--step-1.png)");
    expect(page).toContain("![login--step-1.png](images/login--step-1.png)");
    expect(page).toContain("Go to **checkout**.");
  });

  it("targets the site's default library and a nested folder when site_id and folder are set", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const config = {
      drive_id: undefined,
      site_id: "contoso.sharepoint.com,1,2",
      folder: "Docs/App",
    };
    const result = await createSharePointPublisher().publish(
      makeCtx(dir, projection, capture().log, config),
    );
    expect(result.target).toContain("sites/");
    expect(server.files.has("Docs/App/index.md")).toBe(true);
  });
});

describe("sharepoint publisher: token handling", () => {
  it("sends the token as a bearer header and keeps it out of logs and results", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();

    const result = await createSharePointPublisher().publish(makeCtx(dir, projection, log));
    expect(server.authHeaders.length).toBeGreaterThan(0);
    expect(server.authHeaders.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    for (const file of server.files.values())
      expect(file.data.toString("latin1")).not.toContain(TOKEN);
  });

  it("masks the token as <SHAREPOINT_TOKEN> when the server echoes it in an error", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    server.failEchoingToken = true;

    let message = "";
    try {
      await createSharePointPublisher().publish(makeCtx(dir, projection, log));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 500");
    expect(message).toContain("<SHAREPOINT_TOKEN>");
    expect(message).not.toContain(TOKEN);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });

  it("names the missing variable, never a value, when the token is not set", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.secretsEnv = { token: "SHAREPOINT_ABSENT_TOKEN" };
    await expect(createSharePointPublisher().publish(ctx)).rejects.toThrow(
      "set SHAREPOINT_ABSENT_TOKEN",
    );
    expect(server.writes).toBe(0);
  });

  it("requires a drive or a site", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.config = { graph_base_url: server.baseUrl };
    await expect(createSharePointPublisher().publish(ctx)).rejects.toThrow(
      "drive_id or config.site_id",
    );
  });
});

describe("adf to markdown", () => {
  it("reproduces the engine's markdown subset", () => {
    const source = [
      "Use **bold**, *em* and `code` with a [link](https://example.com/a).",
      "- first\n- second",
      "1. one\n2. two",
      "```\nnpm run build\n```",
    ].join("\n\n");
    const md = adfToMarkdown({ version: 1, type: "doc", content: markdownToAdf(source) });
    expect(md).toBe(source);
  });
});

describe("sharepoint plugin: manifest and runtime", () => {
  it("declares exactly one capability, the Graph host, and stays private", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      private?: boolean;
      docsxai: { namespace: string; kinds: string[]; capabilities: string[]; trust: string };
    };
    expect(pkg.docsxai.capabilities).toEqual(["egress:graph.microsoft.com"]);
    expect(pkg.docsxai.namespace).toBe("sharepoint");
    expect(pkg.docsxai.kinds).toEqual(["publisher"]);
    expect(pkg.private).toBe(true);
  });

  it("resolvePlugins loads sharepoint:push from the built package and it publishes", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:graph.microsoft.com"],
    });
    const record = registry.pluginsInfo("sharepoint");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "sharepoint:push" }]);

    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const result = await registry
      .getPublisher("sharepoint:push")
      .publish(makeCtx(dir, projection, capture().log));
    expect(result.ok).toBe(true);
    expect(result.pages[0]!.action).toBe("created");
  });

  it("is disabled when the egress capability is not operator-enabled", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: [],
    });
    expect(registry.pluginsInfo("sharepoint")?.status).toBe("disabled-by-capability-mismatch");
  });
});
