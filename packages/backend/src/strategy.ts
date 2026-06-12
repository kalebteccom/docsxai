// Webhook output strategies — where a webhook-triggered run's result goes. One strategy per
// project, named in the webhook config:
//   pr-comment      → post the run summary as a GitHub PR issue-comment (commit comment on push)
//   viewer-refresh  → re-render the viewer from the materialized workspace, store it as a blob
//   wiki-push       → invoke the project's configured publisher plugin (engine plugin contract:
//                     package.json `docsxai` manifest + register(api) module) from a local path
// Every effect is injected (fetch, spawn, token provider, store) so strategies test with fakes.

import type { ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BackendStore } from "./store.js";
import type { WebhookJob } from "./webhook.js";

/** The slice of `child_process.spawn` the strategies use (injectable). */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string },
) => Pick<ChildProcess, "stdout" | "stderr" | "on">;

/** Spawn a process and capture exit code + combined output (capped at 64 KiB). */
export function spawnCapture(
  spawnImpl: SpawnLike,
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // .js bins run through the current node — fixture bins in tests aren't chmod+x.
    const viaNode = /\.(c|m)?js$/.test(command);
    const child = spawnImpl(
      viaNode ? process.execPath : command,
      viaNode ? [command, ...args] : args,
      {
        env: { ...process.env, ...opts.env },
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      },
    );
    let output = "";
    const cap = 64 * 1024;
    const sink = (chunk: Buffer) => {
      if (output.length < cap) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", sink);
    child.stderr?.on("data", sink);
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ code, output }));
  });
}

/** What the strategy needs to know about the run it is routing. */
export interface StrategyRunInfo {
  ok: boolean;
  summary: string;
  /** The materialized temp workspace the engine ran against. */
  workspace_dir: string;
}

export interface StrategyResult {
  strategy: string;
  ok: boolean;
  detail: string;
}

export interface StrategyDeps {
  fetchImpl?: typeof fetch;
  spawnImpl?: SpawnLike;
  /** GitHub token source — installation-token wiring goes here (owner-gated). Default: `GITHUB_APP_TOKEN` env. */
  tokenProvider?: () => Promise<string>;
  /** Engine bin for `viewer-refresh` (SpawnRunner threads its resolved bin through). */
  engineBin?: string;
  /** GitHub REST base — tests point this at a local fake. Default `https://api.github.com`. */
  githubApiBase?: string;
  env?: NodeJS.ProcessEnv;
  /** Store access for recording rendered artifacts (`viewer-refresh`). */
  store?: BackendStore;
}

export async function runStrategy(
  job: WebhookJob,
  run: StrategyRunInfo,
  deps: StrategyDeps = {},
): Promise<StrategyResult> {
  switch (job.config.strategy) {
    case "pr-comment":
      return prComment(job, run, deps);
    case "viewer-refresh":
      return viewerRefresh(job, run, deps);
    case "wiki-push":
      return wikiPush(job, run, deps);
    default:
      return {
        strategy: String(job.config.strategy),
        ok: false,
        detail: `unknown strategy "${String(job.config.strategy)}"`,
      };
  }
}

// --- pr-comment --------------------------------------------------------------

async function prComment(
  job: WebhookJob,
  run: StrategyRunInfo,
  deps: StrategyDeps,
): Promise<StrategyResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.tokenProvider ? await deps.tokenProvider() : env.GITHUB_APP_TOKEN;
  if (!token) {
    return {
      strategy: "pr-comment",
      ok: false,
      detail: "no GitHub token (set GITHUB_APP_TOKEN or inject a tokenProvider)",
    };
  }
  const base = (deps.githubApiBase ?? "https://api.github.com").replace(/\/+$/, "");
  const p = job.payload as {
    pull_request?: { number?: number };
    head_commit?: { id?: string };
    after?: string;
  };
  const prNumber = p.pull_request?.number;
  const sha = p.head_commit?.id ?? p.after;
  let url: string;
  let where: string;
  if (typeof prNumber === "number") {
    url = `${base}/repos/${job.repo}/issues/${prNumber}/comments`;
    where = `PR #${prNumber}`;
  } else if (typeof sha === "string" && sha.length > 0) {
    url = `${base}/repos/${job.repo}/commits/${sha}/comments`;
    where = `commit ${sha.slice(0, 12)}`;
  } else {
    return {
      strategy: "pr-comment",
      ok: false,
      detail: "payload has neither pull_request.number nor a head commit sha",
    };
  }
  const body = [
    `### docsxai run ${run.ok ? "passed" : "failed"}`,
    "",
    run.summary,
    "",
    `<sub>delivery \`${job.delivery_id}\` · event \`${job.event}\`</sub>`,
  ].join("\n");
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "docsxai-backend",
    },
    body: JSON.stringify({ body }),
  });
  return {
    strategy: "pr-comment",
    ok: res.ok,
    detail: res.ok ? `commented on ${where}` : `GitHub API ${res.status} posting to ${where}`,
  };
}

// --- viewer-refresh -----------------------------------------------------------

async function viewerRefresh(
  job: WebhookJob,
  run: StrategyRunInfo,
  deps: StrategyDeps,
): Promise<StrategyResult> {
  const spawnImpl = deps.spawnImpl;
  if (!spawnImpl) {
    const { spawn } = await import("node:child_process");
    return viewerRefresh(job, run, { ...deps, spawnImpl: spawn });
  }
  const bin = deps.engineBin ?? "docsxai";
  const outDir = path.join(run.workspace_dir, "viewer");
  const { code, output } = await spawnCapture(
    spawnImpl,
    bin,
    ["render", "--workspace", run.workspace_dir, "--out", outDir],
    { env: deps.env ?? process.env, cwd: run.workspace_dir },
  );
  if (code !== 0) {
    return {
      strategy: "viewer-refresh",
      ok: false,
      detail: `render exited ${code}: ${output.trim().split("\n").pop() ?? ""}`,
    };
  }
  const indexPath = path.join(outDir, "index.html");
  if (deps.store && fs.existsSync(indexPath)) {
    const ref = deps.store.putBlob(fs.readFileSync(indexPath));
    return {
      strategy: "viewer-refresh",
      ok: true,
      detail: `viewer re-rendered (index sha256 ${ref.sha256.slice(0, 12)}…, ${ref.bytes} bytes)`,
    };
  }
  return { strategy: "viewer-refresh", ok: true, detail: "viewer re-rendered" };
}

// --- wiki-push ----------------------------------------------------------------

/** Engine publisher contract (mirrors `@docsxai/engine` plugin types — no dep needed). */
interface PublisherPluginLike {
  publish(ctx: {
    workspaceDir: string;
    projection: unknown;
    artifactsDir: string;
    config: Record<string, unknown>;
    secretsEnv: Record<string, string>;
    log: { info(m: string): void; warn(m: string): void; error(m: string): void };
  }): Promise<{
    ok: boolean;
    target: string;
    pages: Array<{ id: string; action: string }>;
    warnings: string[];
  }>;
}

/**
 * Load publisher plugins the way the engine does (package.json `docsxai` manifest naming a
 * register(api) module; registered names auto-prefixed `<ns>:<name>`), from local path sources:
 * `plugin_config.sources` (dirs, absolute or workspace-relative), falling back to `path:` entries
 * in the workspace's `docsxai.config.json` `plugins` array.
 */
async function loadPublishers(
  job: WebhookJob,
  workspaceDir: string,
): Promise<Map<string, PublisherPluginLike>> {
  const sources: string[] = [];
  const configured = job.config.plugin_config?.sources;
  if (Array.isArray(configured)) {
    for (const s of configured) if (typeof s === "string") sources.push(s);
  } else {
    const wsConfig = path.join(workspaceDir, "docsxai.config.json");
    if (fs.existsSync(wsConfig)) {
      const parsed = JSON.parse(fs.readFileSync(wsConfig, "utf8")) as { plugins?: unknown };
      if (Array.isArray(parsed.plugins)) {
        for (const s of parsed.plugins) {
          if (typeof s === "string" && s.startsWith("path:")) sources.push(s.slice("path:".length));
        }
      }
    }
  }
  const publishers = new Map<string, PublisherPluginLike>();
  for (const src of sources) {
    const dir = path.isAbsolute(src) ? src : path.resolve(workspaceDir, src);
    const manifestPath = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      docsxai?: { namespace?: string; register?: string };
    };
    const ns = pkg.docsxai?.namespace;
    const register = pkg.docsxai?.register;
    if (!ns || !register) throw new Error(`${manifestPath}: no docsxai { namespace, register }`);
    const mod = (await import(pathToFileURL(path.resolve(dir, register)).href)) as {
      register?: unknown;
      default?: unknown;
    };
    const fn = mod.register ?? mod.default;
    if (typeof fn !== "function") {
      throw new Error(`${register} must export a register(api) function`);
    }
    await (
      fn as (api: { registerPublisher(name: string, impl: PublisherPluginLike): void }) => unknown
    )({
      registerPublisher: (bare, impl) => publishers.set(`${ns}:${bare}`, impl),
    });
  }
  return publishers;
}

async function wikiPush(
  job: WebhookJob,
  run: StrategyRunInfo,
  deps: StrategyDeps,
): Promise<StrategyResult> {
  const pluginName = job.config.plugin;
  if (!pluginName) {
    return { strategy: "wiki-push", ok: false, detail: "no publisher plugin configured" };
  }
  const publishers = await loadPublishers(job, run.workspace_dir);
  const publisher = publishers.get(pluginName);
  if (!publisher) {
    return {
      strategy: "wiki-push",
      ok: false,
      detail: `publisher "${pluginName}" not found (loaded: ${[...publishers.keys()].join(", ") || "none"})`,
    };
  }
  const projectionPath = path.join(run.workspace_dir, "projection.json");
  const projection = fs.existsSync(projectionPath)
    ? (JSON.parse(fs.readFileSync(projectionPath, "utf8")) as unknown)
    : {};
  const env = deps.env ?? process.env;
  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const result = await publisher.publish({
    workspaceDir: run.workspace_dir,
    projection,
    artifactsDir: run.workspace_dir,
    config: job.config.plugin_config ?? {},
    secretsEnv: Object.fromEntries(
      Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    log,
  });
  const actions = result.pages.reduce<Record<string, number>>((acc, p) => {
    acc[p.action] = (acc[p.action] ?? 0) + 1;
    return acc;
  }, {});
  const actionSummary =
    Object.entries(actions)
      .map(([a, n]) => `${n} ${a}`)
      .join(", ") || "0 pages";
  return {
    strategy: "wiki-push",
    ok: result.ok,
    detail: `published to ${result.target}: ${actionSummary}${
      result.warnings.length ? ` (${result.warnings.length} warnings)` : ""
    }`,
  };
}
