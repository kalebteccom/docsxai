// Publisher suite against the in-process fake Graph server: idempotent re-push (zero writes),
// targeted update on a prose change, images attached, the bearer token absent from every log
// line and error, the exact capability declaration, and the load through the real plugin runtime.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  markdownToAdf,
  projectDocPackToAdf,
  resolvePlugins,
} from "@docsxai/engine";
import { adfToMarkdown, safeName } from "../src/adf-markdown.js";
import {
  GRAPH_HOSTS,
  GraphClient,
  type GraphClientOptions,
  assertGraphBaseUrl,
  isDownloadUrl,
  readBoundedText,
} from "../src/graph-client.js";
import { MAX_IMAGE_BYTES } from "../src/read-file.js";
import {
  MANIFEST_FILE,
  createSharePointPublisher,
  isSharePointUrl,
  maskToken,
  parseConfig,
} from "../src/publisher.js";
import { type FakeGraph, startFakeGraph } from "./fake-graph.js";

/** The fake Graph server is plain http on loopback, which the publisher refuses unless told otherwise. */
const LOOPBACK = { allowLoopbackHttp: true } as const;

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
    const publisher = createSharePointPublisher(LOOPBACK);
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
    const publisher = createSharePointPublisher(LOOPBACK);
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
    const publisher = createSharePointPublisher(LOOPBACK);
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
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));

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
    const result = await createSharePointPublisher(LOOPBACK).publish(
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

    const result = await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
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
      await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
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
    await expect(createSharePointPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(
      "set SHAREPOINT_ABSENT_TOKEN",
    );
    expect(server.writes).toBe(0);
  });

  it("requires a drive or a site", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log);
    ctx.config = { graph_base_url: server.baseUrl };
    await expect(createSharePointPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(
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
  it("declares the Graph host and the SharePoint download hosts, and stays private", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      private?: boolean;
      docsxai: { namespace: string; kinds: string[]; capabilities: string[]; trust: string };
    };
    expect(pkg.docsxai.capabilities).toEqual([
      "egress:graph.microsoft.com",
      "egress:*.sharepoint.com",
    ]);
    expect(pkg.docsxai.namespace).toBe("sharepoint");
    expect(pkg.docsxai.kinds).toEqual(["publisher"]);
    expect(pkg.private).toBe(true);
  });

  it("resolvePlugins loads sharepoint:push from the built package and it refuses a non-Graph endpoint", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // run `pnpm -r build` first

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({
      workspaceDir: dir,
      sources: [{ path: PKG_ROOT }],
      enabledCapabilities: ["egress:graph.microsoft.com", "egress:*.sharepoint.com"],
    });
    const record = registry.pluginsInfo("sharepoint");
    expect(record?.status).toBe("loaded");
    expect(record?.artifacts).toEqual([{ kind: "publisher", name: "sharepoint:push" }]);

    // The loaded publisher takes no test option, so it refuses the plain-http fake server.
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await expect(
      registry.getPublisher("sharepoint:push").publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow("graph_base_url must be https");
    expect(server.authHeaders).toEqual([]);
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

describe("sharepoint publisher: graph_base_url", () => {
  it.each(GRAPH_HOSTS)("accepts https on %s and trims trailing slashes", (host) => {
    expect(assertGraphBaseUrl(`https://${host}/v1.0//`)).toBe(`https://${host}/v1.0`);
  });

  it.each([
    "http://graph.microsoft.com/v1.0",
    "https://evil.example.com/v1.0",
    "https://graph.microsoft.com.evil.example.com/v1.0",
    "https://evil.example.com/graph.microsoft.com",
    "https://user:pw@graph.microsoft.com/v1.0",
    "https://login.microsoftonline.com/v1.0",
    "ftp://graph.microsoft.com/v1.0",
    "graph.microsoft.com/v1.0",
    "http://127.0.0.1:4000/v1.0",
    "http://localhost/v1.0",
  ])("refuses %s", (url) => {
    expect(() => assertGraphBaseUrl(url)).toThrow(/graph_base_url/);
  });

  it.each([
    "https://graph.microsoft.com/v1.0?tenant=x",
    "https://graph.microsoft.com/v1.0?",
    "https://graph.microsoft.com/v1.0#frag",
    "https://graph.microsoft.com/v1.0#",
    "https://graph.microsoft.com",
    "https://graph.microsoft.com/",
    "https://graph.microsoft.com/v2.0",
    "https://graph.microsoft.com/v1.0/sites",
    "https://graph.microsoft.com/v1%2E0",
    "https://graph.microsoft.com/beta/v1.0",
  ])("refuses %s: a query, a fragment or a path other than /v1.0 and /beta", (url) => {
    expect(() => assertGraphBaseUrl(url)).toThrow(/graph_base_url/);
  });

  it("returns the parsed origin and path: /beta passes, the host is lower-cased, :443 is dropped", () => {
    expect(assertGraphBaseUrl("https://graph.microsoft.com/beta/")).toBe(
      "https://graph.microsoft.com/beta",
    );
    expect(assertGraphBaseUrl("https://GRAPH.Microsoft.com:443/v1.0")).toBe(
      "https://graph.microsoft.com/v1.0",
    );
  });

  it("refuses a port other than the default, and takes an explicit :443", () => {
    for (const url of [
      "https://graph.microsoft.com:8443/v1.0",
      "https://graph.microsoft.us:444/v1.0",
      "https://graph.microsoft.com:80/v1.0",
    ]) {
      expect(() => assertGraphBaseUrl(url)).toThrow(/default https port/);
    }
    expect(assertGraphBaseUrl("https://graph.microsoft.com:443/v1.0")).toBe(
      "https://graph.microsoft.com/v1.0",
    );
  });

  it("takes loopback http only under the explicit test option", () => {
    expect(assertGraphBaseUrl("http://127.0.0.1:4000/v1.0", LOOPBACK)).toBe(
      "http://127.0.0.1:4000/v1.0",
    );
    expect(() => assertGraphBaseUrl("http://evil.example.com/v1.0", LOOPBACK)).toThrow(
      /graph_base_url/,
    );
    expect(() => assertGraphBaseUrl("https://127.0.0.1/v1.0", LOOPBACK)).toThrow(/graph_base_url/);
  });

  it("parseConfig applies the same rule, and the default is the public Graph", () => {
    expect(parseConfig({ drive_id: "d" }).graph_base_url).toBe("https://graph.microsoft.com/v1.0");
    expect(() => parseConfig({ drive_id: "d", graph_base_url: "http://x.test/v1.0" })).toThrow(
      /graph_base_url/,
    );
  });

  it("the client refuses a host outside the allowlist before any request", () => {
    expect(
      () => new GraphClient("https://evil.example.com/v1.0", { root: "drives/d" }, "t", (s) => s),
    ).toThrow(/graph_base_url/);
  });

  it("publish with an off-list endpoint fails and sends nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const ctx = makeCtx(dir, projection, capture().log, {
      graph_base_url: "https://graph.microsoft.com.evil.example.com/v1.0",
    });
    await expect(createSharePointPublisher(LOOPBACK).publish(ctx)).rejects.toThrow(
      /graph_base_url/,
    );
    expect(server.authHeaders).toEqual([]);
  });
});

describe("sharepoint publisher: attachments", () => {
  it("refuses a source path outside the workspace and uploads nothing", async () => {
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
      createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
    expect(server.writes).toBe(0);
  });

  it("refuses a source path that climbs out with ..", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    projection.documents[0]!.attachments[0]!.sourcePath = path.join(dir, "..", "etc-passwd");
    await expect(
      createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
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
      createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/escapes workspace root/);
  });

  it("hashes the bytes it read, not the sha256 the projection claims", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    for (const att of projection.documents[0]!.attachments) att.sha256 = "0".repeat(64);
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    const manifest = JSON.parse(text(`docsxai/${MANIFEST_FILE}`)) as {
      files: Record<string, { sha256: string }>;
    };
    expect(manifest.files["images/login--step-1.png"]!.sha256).toBe(
      createHash("sha256").update(PNG_B).digest("hex"),
    );
    // A second push with the same wrong claim still sees the images as unchanged.
    const before = server.writes;
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(server.writes).toBe(before);
  });
});

describe("sharepoint publisher: attachment reads", () => {
  async function publishWith(
    dir: string,
    edit: (att: { sourcePath: string; sha256: string }) => void,
  ): Promise<unknown> {
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    edit(projection.documents[0]!.attachments[0]!);
    return createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
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
    const file = path.join(dir, "docs", "checkout", "burned", "step-1.png");
    await fs.writeFile(file, data);
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(server.files.get("docsxai/images/checkout--step-1.png")!.data.equals(data)).toBe(true);
  });
});

describe("sharepoint publisher: redirects", () => {
  it("does not follow a redirect on a write, so the token stays on the first host", async () => {
    const other = await startFakeGraph(TOKEN);
    try {
      server.redirectWritesTo = `${other.baseUrl}/drives/d/root:/docsxai/index.md:/content`;
      const dir = await makeWorkspace();
      const projection = await projectDocPackToAdf({ workspaceDir: dir });
      await expect(
        createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
      ).rejects.toThrow(/PUT .* failed/);
      expect(other.authHeaders).toEqual([]);
      expect(other.files.size).toBe(0);
    } finally {
      await other.close();
    }
  });
});

/** A client on the fake server, as the publisher builds it. */
function clientFor(options: GraphClientOptions = {}): GraphClient {
  return new GraphClient(server.baseUrl, { root: "drives/d" }, TOKEN, maskToken(TOKEN), {
    ...LOOPBACK,
    ...options,
  });
}

function seed(itemPath: string, content: string): void {
  server.files.set(itemPath, { data: Buffer.from(content), contentType: "text/plain", id: "seed" });
}

describe("sharepoint client: read redirected to a download URL", () => {
  it("follows the one hop without the bearer token and returns the file", async () => {
    seed("docsxai/a.txt", "hello");
    expect(await clientFor().readText("docsxai/a.txt")).toBe("hello");
    expect(server.authHeaders).toEqual([`Bearer ${TOKEN}`]);
    expect(server.downloadAuthHeaders).toEqual([""]);
  });

  it("still reads a plain 200 answer, and a missing item is null without a hop", async () => {
    server.redirectReadsToDownload = false;
    seed("docsxai/a.txt", "direct");
    expect(await clientFor().readText("docsxai/a.txt")).toBe("direct");
    expect(await clientFor().readText("docsxai/none.txt")).toBeNull();
    expect(server.downloadAuthHeaders).toEqual([]);
  });

  it("a second push reads its manifest through the redirect and writes nothing", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const publisher = createSharePointPublisher(LOOPBACK);
    await publisher.publish(makeCtx(dir, projection, capture().log));
    const settled = server.writes;
    const run2 = await publisher.publish(makeCtx(dir, projection, capture().log));
    expect(run2.pages.map((p) => p.action)).toEqual(["unchanged"]);
    expect(server.writes).toBe(settled);
    expect(server.downloadAuthHeaders).toEqual([""]);
  });

  it("an error answer from the download URL fails the read, it is not read as a missing file", async () => {
    seed("docsxai/a.txt", "hello");
    server.redirectReadsTo = `${new URL(server.baseUrl).origin}/download/nope`;
    await expect(clientFor().readText("docsxai/a.txt")).rejects.toThrow(/HTTP 404/);
  });

  it.each([
    "https://evil.example.com/x",
    "https://contoso.sharepoint.com.evil.example.com/x",
    "https://evilsharepoint.com/x",
    "https://sharepoint.com/x",
    "http://contoso.sharepoint.com/x",
    "https://contoso.sharepoint.com:8443/x",
    "https://" + "user" + ":" + "pw" + "@contoso.sharepoint.com/x",
    "ftp://contoso.sharepoint.com/x",
  ])("refuses a redirect to %s and sends nothing there", async (location) => {
    seed("docsxai/a.txt", "hello");
    server.redirectReadsTo = location;
    await expect(clientFor().readText("docsxai/a.txt")).rejects.toThrow(
      /not a SharePoint download URL/,
    );
    expect(server.downloadAuthHeaders).toEqual([]);
  });

  it("refuses a download URL that redirects again", async () => {
    seed("docsxai/a.txt", "hello");
    server.downloadRedirectsTo = "https://contoso.sharepoint.com/x";
    await expect(clientFor().readText("docsxai/a.txt")).rejects.toThrow(/redirected again/);
  });

  it("isDownloadUrl takes https on a SharePoint subdomain, and loopback http only under the test option", () => {
    for (const ok of [
      "https://contoso.sharepoint.com/a",
      "https://contoso-my.sharepoint.com/a?tempauth=x",
      "https://contoso.sharepoint.us/a",
      "https://contoso.sharepoint.cn/a",
      "https://contoso.sharepoint.de/a",
      "https://contoso.sharepoint.com:443/a",
    ]) {
      expect(isDownloadUrl(ok)).toBe(true);
    }
    expect(isDownloadUrl("http://127.0.0.1:4000/a")).toBe(false);
    expect(isDownloadUrl("http://127.0.0.1:4000/a", LOOPBACK)).toBe(true);
    expect(isDownloadUrl("http://contoso.sharepoint.com/a", LOOPBACK)).toBe(false);
    expect(isDownloadUrl("not a url")).toBe(false);
  });
});

describe("sharepoint client: timeouts and error bodies", () => {
  const FAST = { apiTimeoutMs: 300, uploadTimeoutMs: 300 };

  it("ends a stalled read with a timeout error", async () => {
    server.stall = ["GET docsxai/a.txt"];
    const started = Date.now();
    await expect(clientFor(FAST).readText("docsxai/a.txt")).rejects.toThrow(
      /GET docsxai\/a.txt timed out after 300 ms/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("ends a response body that never finishes with a timeout error", async () => {
    server.stallBody = ["GET docsxai/a.txt"];
    await expect(clientFor(FAST).readText("docsxai/a.txt")).rejects.toThrow(
      /timed out reading the response/,
    );
  });

  it("ends a stalled upload with a timeout error and stores nothing", async () => {
    server.stall = ["PUT docsxai/a.txt"];
    await expect(
      clientFor(FAST).upload("docsxai/a.txt", new Uint8Array([1]), "text/plain"),
    ).rejects.toThrow(/PUT docsxai\/a.txt timed out after 300 ms/);
    expect(server.writes).toBe(0);
  });

  it("masks the token before cutting an error body, so no part of it survives the cut", async () => {
    server.failEchoingToken = true;
    server.errorPadding = 452; // the echoed token starts at character 490 and ends past 500
    let message = "";
    try {
      await clientFor().readText("docsxai/a.txt");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 500");
    expect(message).not.toContain(TOKEN.slice(0, 10));
  });
});

describe("sharepoint publisher: file names and folder", () => {
  it.each([".", "..", "...", "-.-", " .. "])("safeName refuses the all-dot name %j", (raw) => {
    expect(() => safeName(raw)).toThrow(/not a usable file name/);
  });

  it("safeName keeps ordinary names, dots inside included", () => {
    expect(safeName("a..b")).toBe("a..b");
    expect(safeName("checkout--step-1.png")).toBe("checkout--step-1.png");
    expect(safeName("")).toBe("item");
  });

  it.each(["..", "../x", "a/../b", "./a", "a/./b", "..."])("refuses folder %j", (folder) => {
    expect(() => parseConfig({ drive_id: "d", folder })).toThrow(/config\.folder/);
  });

  it("keeps a nested folder and drops empty segments", () => {
    expect(parseConfig({ drive_id: "d", folder: "/Docs//App/" }).folder).toBe("Docs/App");
  });
});

describe("sharepoint publisher: remote manifest", () => {
  const goodEntry = (sha: string) => ({ sha256: sha, size: 1 });

  it("isSharePointUrl wants https on a SharePoint domain", () => {
    expect(isSharePointUrl("https://contoso.sharepoint.com/sites/a/b.md")).toBe(true);
    expect(isSharePointUrl("https://contoso.sharepoint.us/x")).toBe(true);
    expect(isSharePointUrl("http://contoso.sharepoint.com/x")).toBe(false);
    expect(isSharePointUrl("https://evil.example.com/x")).toBe(false);
    expect(isSharePointUrl("https://sharepoint.com.evil.example.com/x")).toBe(false);
    expect(isSharePointUrl("https://u:p@contoso.sharepoint.com/x")).toBe(false);
    expect(isSharePointUrl("javascript:alert(1)")).toBe(false);
    expect(isSharePointUrl(42)).toBe(false);
  });

  async function seedManifest(files: Record<string, unknown>) {
    server.files.set(`docsxai/${MANIFEST_FILE}`, {
      data: Buffer.from(JSON.stringify({ schema: "docsxai/sharepoint-manifest@1", files })),
      contentType: "application/json",
      id: "manifest",
    });
  }

  it("drops entries with a bad sha256, size, id or webUrl and uploads those files again", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const { log, lines } = capture();
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    const good = JSON.parse(text(`docsxai/${MANIFEST_FILE}`)) as {
      files: Record<string, { sha256: string; size: number; webUrl?: string }>;
    };
    const index = good.files["index.md"]!;
    const writes = server.writes;

    await seedManifest({
      ...good.files,
      "index.md": { ...index, webUrl: "https://evil.example.com/phish" },
      "images/login--step-1.png": { ...good.files["images/login--step-1.png"], sha256: "XYZ" },
      "images/checkout--step-1.png": { ...good.files["images/checkout--step-1.png"], size: -1 },
    });
    lines.length = 0;
    const run = await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(server.writes - writes).toBe(4); // 3 re-uploads + manifest
    expect(lines.filter((l) => l.includes("is not valid")).length).toBe(3);
    expect(run.pages[0]!.url).toContain("sharepoint.com");
    expect(JSON.stringify(run)).not.toContain("evil.example.com");
    expect(text(`docsxai/${MANIFEST_FILE}`)).not.toContain("evil.example.com");
  });

  it("names at most 20 invalid manifest entries, then counts the rest in one line", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const bad = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`images/x-${i}.png`, { sha256: "nope", size: 1 }]),
    );
    await seedManifest(bad);
    const { log, lines } = capture();
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, log));
    expect(lines.filter((l) => l.includes("is not valid, uploading it again")).length).toBe(20);
    expect(lines.filter((l) => l.includes("5 more manifest entries are not valid")).length).toBe(1);
  });

  it("refuses a manifest whose files is not an object", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.files.set(`docsxai/${MANIFEST_FILE}`, {
      data: Buffer.from(JSON.stringify({ schema: "docsxai/sharepoint-manifest@1", files: [1] })),
      contentType: "application/json",
      id: "m",
    });
    await expect(
      createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow("is not a docsxai manifest");
  });

  it("keeps a __proto__ key in the manifest from touching prototypes", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.files.set(`docsxai/${MANIFEST_FILE}`, {
      data: Buffer.from(
        `{"schema":"docsxai/sharepoint-manifest@1","files":{"__proto__":${JSON.stringify(goodEntry("a".repeat(64)))}}}`,
      ),
      contentType: "application/json",
      id: "m",
    });
    await createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log));
    expect(({} as Record<string, unknown>)["sha256"]).toBeUndefined();
  });

  it("refuses a manifest over 8 MiB", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    server.files.set(`docsxai/${MANIFEST_FILE}`, {
      data: Buffer.alloc(8 * 1024 * 1024 + 1, 0x20),
      contentType: "application/json",
      id: "m",
    });
    await expect(
      createSharePointPublisher(LOOPBACK).publish(makeCtx(dir, projection, capture().log)),
    ).rejects.toThrow(/over 8388608 bytes/);
    expect(server.writes).toBe(0);
  });
});

describe("sharepoint client: bounded reads", () => {
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
});
