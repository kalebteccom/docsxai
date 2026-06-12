// The real webhook run executor. Materializes the configured revision's artifacts from the store
// into a temp workspace dir (same-process store reads — no HTTP hop), spawns the engine CLI
// (`docsxai run`), records the outcome in run-history, then routes output through the configured
// strategy. Everything effectful is injectable (spawn, strategy, env) so the whole path is
// unit-testable with a fake engine bin.

import { spawn as nodeSpawn } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BackendStore } from "./store.js";
import type { WebhookJob } from "./webhook.js";
import {
  runStrategy,
  spawnCapture,
  type SpawnLike,
  type StrategyDeps,
  type StrategyResult,
} from "./strategy.js";

export const ENGINE_BIN_ENV = "DOCSX_ENGINE_BIN";
export const ENGINE_PACKAGE = "@docsxai/engine";
export const ENGINE_BIN_NAME = "docsxai";

/**
 * Resolve the engine CLI like the engine resolves its viewer bin:
 *   1. `DOCSX_ENGINE_BIN` env override (a path to the bin script);
 *   2. the installed `@docsxai/engine` package's `docsxai` bin entry;
 *   3. bare `docsxai` on PATH.
 */
export function resolveEngineBin(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[ENGINE_BIN_ENV];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const require_ = createRequire(import.meta.url);
    const manifestPath = require_.resolve(`${ENGINE_PACKAGE}/package.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[ENGINE_BIN_NAME];
    if (rel) {
      const abs = path.resolve(path.dirname(manifestPath), rel);
      if (fs.existsSync(abs)) return abs;
    }
  } catch {
    // not installed next to the backend — fall through to PATH
  }
  return ENGINE_BIN_NAME;
}

/** Outcome of one engine invocation (before strategy routing). */
export interface RunOutcome {
  ok: boolean;
  exit_code: number | null;
  duration_ms: number;
  summary: string;
  workspace_dir: string;
}

export interface SpawnRunnerOptions {
  store: BackendStore;
  /** Engine bin override (tests point this at a fixture script). Default: {@link resolveEngineBin}. */
  engineBin?: string;
  spawnImpl?: SpawnLike;
  env?: NodeJS.ProcessEnv;
  /** Base dir for materialized temp workspaces. Default: `os.tmpdir()`. */
  workRoot?: string;
  /** Strategy executor override (default: the real {@link runStrategy}). */
  strategy?: (job: WebhookJob, outcome: RunOutcome, deps: StrategyDeps) => Promise<StrategyResult>;
  /** Extra deps threaded into the default strategy executor (fetch, token provider, API base). */
  strategyDeps?: StrategyDeps;
  /** Keep the materialized workspace dir for inspection instead of deleting it. */
  keepWorkspace?: boolean;
}

/**
 * Executes one webhook job end-to-end: materialize → run engine → append run-history → strategy.
 * Plug `executeRun` into a `QueuedDispatcher`.
 */
export class SpawnRunner {
  constructor(private readonly opts: SpawnRunnerOptions) {}

  /** Pull the configured revision's artifacts into a fresh temp workspace dir. */
  materializeWorkspace(job: WebhookJob): string {
    const { store, workRoot } = this.opts;
    const rev = store.getRevision(job.workspace_id, job.project_id, job.config.workspace_rev);
    const dir = fs.mkdtempSync(path.join(workRoot ?? os.tmpdir(), "docsxai-webhook-"));
    for (const slot of rev.artifacts) {
      const payload = store.getArtifact(job.workspace_id, job.project_id, rev.id, slot);
      fs.writeFileSync(path.join(dir, `${slot}.json`), JSON.stringify(payload, null, 2) + "\n");
    }
    fs.writeFileSync(
      path.join(dir, "webhook-job.json"),
      JSON.stringify(
        { delivery_id: job.delivery_id, event: job.event, repo: job.repo, revision_id: rev.id },
        null,
        2,
      ) + "\n",
    );
    return dir;
  }

  async executeRun(job: WebhookJob): Promise<RunOutcome & { strategy?: StrategyResult }> {
    const { store } = this.opts;
    const env = this.opts.env ?? process.env;
    const bin = this.opts.engineBin ?? resolveEngineBin(env);
    const spawnImpl: SpawnLike = this.opts.spawnImpl ?? nodeSpawn;

    const workspaceDir = this.materializeWorkspace(job);
    const started = Date.now();
    let outcome: RunOutcome;
    try {
      const { code, output } = await spawnCapture(
        spawnImpl,
        bin,
        ["run", "--workspace", workspaceDir],
        {
          env,
          cwd: workspaceDir,
        },
      );
      const lastLine = output.trim().split("\n").filter(Boolean).pop() ?? "";
      outcome = {
        ok: code === 0,
        exit_code: code,
        duration_ms: Date.now() - started,
        summary: lastLine || `engine exited ${code}`,
        workspace_dir: workspaceDir,
      };
    } catch (e) {
      outcome = {
        ok: false,
        exit_code: null,
        duration_ms: Date.now() - started,
        summary: `engine spawn failed: ${(e as Error).message}`,
        workspace_dir: workspaceDir,
      };
    }

    let strategyResult: StrategyResult | undefined;
    try {
      const exec = this.opts.strategy ?? runStrategy;
      strategyResult = await exec(job, outcome, {
        spawnImpl,
        env,
        engineBin: bin,
        store,
        ...this.opts.strategyDeps,
      });
    } catch (e) {
      strategyResult = {
        strategy: job.config.strategy,
        ok: false,
        detail: `strategy failed: ${(e as Error).message}`,
      };
    }

    store.appendRun(job.workspace_id, job.project_id, {
      rev: job.config.workspace_rev,
      ok: outcome.ok && strategyResult.ok,
      duration_ms: outcome.duration_ms,
      summary: `[webhook ${job.event} ${job.delivery_id}] ${outcome.summary}; ${strategyResult.strategy}: ${strategyResult.detail}`,
    });

    if (!this.opts.keepWorkspace) fs.rmSync(workspaceDir, { recursive: true, force: true });
    return { ...outcome, strategy: strategyResult };
  }
}
