import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebhookConfig, WebhookStrategy } from "../src/api.js";
import { MemoryStore } from "../src/index.js";
import { runStrategy, type StrategyRunInfo } from "../src/strategy.js";
import type { WebhookJob } from "../src/webhook.js";

const FAKE_BIN = fileURLToPath(new URL("./fixtures/fake-engine.cjs", import.meta.url));
const RECORDER_PLUGIN_DIR = fileURLToPath(new URL("./fixtures/recorder-plugin", import.meta.url));

function makeJob(
  strategy: WebhookStrategy,
  payload: unknown,
  extra: Partial<WebhookConfig> = {},
): WebhookJob {
  return {
    delivery_id: "d-strategy",
    event: "push",
    workspace_id: "ws",
    project_id: "p",
    repo: "octo-org/docs-site",
    config: {
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy,
      workspace_rev: "head",
      secret_env: "DOCSX_WEBHOOK_SECRET",
      enabled: true,
      ...extra,
    },
    payload,
  };
}

let workspaceDir = "";
let run: StrategyRunInfo;

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-strategy-"));
  run = { ok: true, summary: "documented 3 flows, 0 drifted", workspace_dir: workspaceDir };
});
afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

// --- fake GitHub API ----------------------------------------------------------

interface RecordedRequest {
  method: string;
  url: string;
  auth: string | undefined;
  body: unknown;
}
let ghRequests: RecordedRequest[] = [];
let ghStatus = 201;
let ghServer: http.Server;
let ghBase = "";

beforeAll(async () => {
  ghServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      ghRequests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"),
      });
      res.writeHead(ghStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 1 }));
    });
  });
  ghBase = await new Promise<string>((resolve) => {
    ghServer.listen(0, "127.0.0.1", () => {
      const addr = ghServer.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
});
afterAll(() => {
  ghServer.close();
});
beforeEach(() => {
  ghRequests = [];
  ghStatus = 201;
});

describe("pr-comment strategy", () => {
  const deps = () => ({
    githubApiBase: ghBase,
    env: { GITHUB_APP_TOKEN: "gh-token" } as NodeJS.ProcessEnv,
  });

  it("posts a PR issue-comment for pull_request payloads", async () => {
    const job = makeJob("pr-comment", { pull_request: { number: 7 } });
    job.event = "pull_request";
    const result = await runStrategy(job, run, deps());
    expect(result).toMatchObject({
      strategy: "pr-comment",
      ok: true,
      detail: "commented on PR #7",
    });
    expect(ghRequests).toHaveLength(1);
    expect(ghRequests[0]).toMatchObject({
      method: "POST",
      url: "/repos/octo-org/docs-site/issues/7/comments",
      auth: "Bearer gh-token",
    });
    const body = (ghRequests[0]!.body as { body: string }).body;
    expect(body).toContain("docsxai run passed");
    expect(body).toContain("documented 3 flows");
  });

  it("falls back to a commit comment for push payloads", async () => {
    const sha = "59b20b8d5c6ff8d09518454d4dd8b7b30f095ab5";
    const job = makeJob("pr-comment", { head_commit: { id: sha } });
    const result = await runStrategy(job, run, deps());
    expect(result.ok).toBe(true);
    expect(ghRequests[0]!.url).toBe(`/repos/octo-org/docs-site/commits/${sha}/comments`);
  });

  it("prefers an injected tokenProvider over the env token", async () => {
    const job = makeJob("pr-comment", { pull_request: { number: 1 } });
    await runStrategy(job, run, {
      ...deps(),
      tokenProvider: () => Promise.resolve("installation-token"),
    });
    expect(ghRequests[0]!.auth).toBe("Bearer installation-token");
  });

  it("fails without any token and posts nothing", async () => {
    const job = makeJob("pr-comment", { pull_request: { number: 1 } });
    const result = await runStrategy(job, run, { githubApiBase: ghBase, env: {} });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("no GitHub token");
    expect(ghRequests).toHaveLength(0);
  });

  it("surfaces GitHub API errors as a failed result", async () => {
    ghStatus = 502;
    const job = makeJob("pr-comment", { pull_request: { number: 1 } });
    const result = await runStrategy(job, run, deps());
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("502");
  });

  it("fails cleanly when the payload identifies neither a PR nor a commit", async () => {
    const job = makeJob("pr-comment", { zen: "Approachable is better than simple." });
    const result = await runStrategy(job, run, deps());
    expect(result.ok).toBe(false);
    expect(ghRequests).toHaveLength(0);
  });
});

describe("viewer-refresh strategy", () => {
  it("re-renders the viewer with the engine and records the artifact as a blob", async () => {
    const store = new MemoryStore();
    const job = makeJob("viewer-refresh", {});
    const result = await runStrategy(job, run, { engineBin: FAKE_BIN, store });
    expect(result.ok).toBe(true);
    const rendered = fs.readFileSync(path.join(workspaceDir, "viewer", "index.html"));
    expect(rendered.toString()).toBe("<html>fake viewer</html>");
    const sha = createHash("sha256").update(rendered).digest("hex");
    expect(store.hasBlob(sha)).toEqual({ sha256: sha, bytes: rendered.byteLength });
    expect(result.detail).toContain(sha.slice(0, 12));
  });

  it("reports a failed render", async () => {
    const job = makeJob("viewer-refresh", {});
    const result = await runStrategy(job, run, {
      engineBin: FAKE_BIN,
      store: new MemoryStore(),
      env: { ...process.env, FAKE_ENGINE_EXIT: "3" },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("exited 3");
  });
});

describe("wiki-push strategy", () => {
  it("loads the publisher plugin from plugin_config.sources and reports the PublishResult", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "projection.json"),
      JSON.stringify({ sections: ["intro", "flows"] }),
    );
    const job = makeJob(
      "wiki-push",
      {},
      {
        plugin: "recorder:push",
        plugin_config: { sources: [RECORDER_PLUGIN_DIR], space: "DOCS" },
      },
    );
    const result = await runStrategy(job, run, {});
    expect(result).toMatchObject({ strategy: "wiki-push", ok: true });
    expect(result.detail).toContain("fake-wiki/SPACE");
    expect(result.detail).toContain("1 created");
    expect(result.detail).toContain("1 updated");
    const call = JSON.parse(fs.readFileSync(path.join(workspaceDir, "publish-call.json"), "utf8"));
    expect(call.config).toMatchObject({ space: "DOCS" });
    expect(call.projection).toEqual({ sections: ["intro", "flows"] });
  });

  it("loads plugin sources from the workspace docsxai.config.json when not inlined", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "docsxai.config.json"),
      JSON.stringify({ plugins: [`path:${RECORDER_PLUGIN_DIR}`] }),
    );
    const job = makeJob("wiki-push", {}, { plugin: "recorder:push", plugin_config: {} });
    const result = await runStrategy(job, run, {});
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, "publish-call.json"))).toBe(true);
  });

  it("fails when the configured publisher is not registered", async () => {
    const job = makeJob(
      "wiki-push",
      {},
      {
        plugin: "confluence:push",
        plugin_config: { sources: [RECORDER_PLUGIN_DIR] },
      },
    );
    const result = await runStrategy(job, run, {});
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('publisher "confluence:push" not found');
    expect(result.detail).toContain("recorder:push");
  });
});
