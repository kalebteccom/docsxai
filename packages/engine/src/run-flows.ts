// The flow-execution loop behind `docsxai run`: one Playwright session per flow, a worker pool for
// `--concurrency`, and the write of each flow's annotations.json under an output root. Split out of
// the CLI handler so `run --verify-determinism` drives the identical code path against an isolated
// output root instead of the workspace.

import { promises as fs } from "node:fs";
import { type StorageState } from "./auth.js";
import { type FlowFile } from "./doc-pack.js";
import { FlowExecutionError } from "./flow-halt.js";
import { runFlow } from "./flow-runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

export interface RunFlowsOptions {
  /** The workspace: flows, auth and `upload` sources resolve against it. */
  projectDir: string;
  /** Where `docs/<flow>/…` is written. The workspace itself for a plain `run`. */
  outputRoot: string;
  flows: FlowFile[];
  storageState?: StorageState | undefined;
  baseURL?: string | undefined;
  headed: boolean;
  ignoreHTTPSErrors: boolean;
  cdpEndpoint?: string | undefined;
  stopAfter?: string | undefined;
  startFrom?: string | undefined;
  pause: boolean;
  /** `annotations.obstacles` from the workspace config. */
  obstacles: boolean;
  concurrency: number;
  /** Progress lines (`run: …`). stdout for `run`; stderr in verify mode so stdout stays the report. */
  progress: (line: string) => void;
}

/** A flow that did not finish. `step` is set when the runtime halted on a step. */
export interface FlowFailure {
  flow: string;
  step: string | null;
  message: string;
}

export interface RunFlowsResult {
  okCount: number;
  failures: FlowFailure[];
}

/** Merge a `--start-from` partial run into the annotations file already on disk, by step id. */
async function mergeAnnotations(
  annotationsPath: string,
  fresh: Awaited<ReturnType<typeof runFlow>>["annotations"],
): Promise<typeof fresh> {
  try {
    const existing = JSON.parse(await fs.readFile(annotationsPath, "utf8")) as typeof fresh;
    const newStepIds = new Set(fresh.annotations.map((a) => a.step));
    const merged = [
      ...existing.annotations.filter((a) => !newStepIds.has(a.step)),
      ...fresh.annotations,
    ];
    return { ...fresh, annotations: merged };
  } catch {
    // No existing file (or unreadable) — just write what we have.
    return fresh;
  }
}

/** Execute `opts.flows`, up to `opts.concurrency` at a time, each in its own browser session. */
export async function runFlowsInSessions(opts: RunFlowsOptions): Promise<RunFlowsResult> {
  const { projectDir, outputRoot, startFrom, stopAfter, pause } = opts;
  const tag = opts.concurrency > 1 ? (name: string) => `run [${name}]: ` : () => "run: ";
  const say = (line: string) => opts.progress(line);
  const failures: FlowFailure[] = [];

  async function runOne(flow: FlowFile): Promise<boolean> {
    const name = flow.name;
    let session;
    try {
      // When attaching to an existing Chrome via --cdp, the operator owns its auth state — don't
      // load cached `storageState` over it (would replace cookies). When launching fresh, do.
      session = await launchPlaywrightSession({
        baseURL: opts.baseURL,
        headed: opts.headed,
        ignoreHTTPSErrors: opts.ignoreHTTPSErrors,
        ...(opts.cdpEndpoint
          ? { connectOverCdp: opts.cdpEndpoint }
          : { storageState: opts.storageState }),
        ...(flow.environment ? { environment: flow.environment } : {}),
        docPackRoot: projectDir,
        outputRoot,
      });
    } catch (e) {
      const msg = (e as Error).message;
      const reason = /Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)
        ? "no Chromium binary found.  Install one:  npx playwright-core install chromium  (source checkout: pnpm -C packages/engine exec playwright-core install chromium)"
        : `failed to launch browser: ${msg}`;
      process.stderr.write(`${tag(name)}${reason}\n`);
      failures.push({ flow: name, step: null, message: reason });
      return false;
    }
    try {
      const result = await runFlow(flow, session.driver, {
        resolveLocator: (n) => flow.locators[n],
        ...(stopAfter ? { stopAfter } : {}),
        ...(startFrom ? { startFrom } : {}),
        ...(opts.obstacles ? { obstacles: true } : {}),
      });
      await fs.mkdir(resolveWorkspacePath(outputRoot, "docs", flow.name), { recursive: true });
      // Flow names come from the flow-files — resolve the write target symlink-aware.
      const annotationsPath = await resolveWorkspacePathReal(
        outputRoot,
        "docs",
        flow.name,
        "annotations.json",
      );
      // With `startFrom`, only the post-startFrom steps emit annotations — merge them into the
      // existing file (if any) by step id so the prior steps' annotations stay in place. Same
      // story for screenshots (they live as separate PNGs and are simply not re-captured).
      const toWrite = startFrom
        ? await mergeAnnotations(annotationsPath, result.annotations)
        : result.annotations;
      await fs.writeFile(annotationsPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
      say(
        `${tag(name)}${name} — ${result.steps.length} step(s) executed, ${result.annotations.annotations.length} annotation(s) ${startFrom ? "merged" : "written"}\n`,
      );
      return true;
    } catch (e) {
      const message = (e as Error).message;
      process.stderr.write(`${tag(name)}${message}\n`);
      failures.push({
        flow: name,
        step: e instanceof FlowExecutionError ? e.stepId : null,
        message,
      });
      return false;
    } finally {
      if (pause) {
        say("run: --pause — browser is open at the last step run; close it to exit.\n");
        await new Promise<void>((resolve) => session.browser.on("disconnected", () => resolve()));
      }
      await session.close();
    }
  }

  let idx = 0;
  let okCount = 0;
  async function worker(): Promise<void> {
    while (idx < opts.flows.length) {
      const flow = opts.flows[idx++]!;
      if (await runOne(flow)) okCount++;
    }
  }
  const workers = Math.min(opts.concurrency, opts.flows.length);
  if (workers > 1)
    say(`run: running ${opts.flows.length} flows with ${workers} parallel worker(s)…\n`);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  // Workers finish in completion order; sort so the failure list is stable across runs.
  failures.sort((a, b) => (a.flow < b.flow ? -1 : a.flow > b.flow ? 1 : 0));
  return { okCount, failures };
}
