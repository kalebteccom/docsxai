// run_flows — deterministic execution of the workspace's flows (the same engine functions
// `docsxai run` wraps: parse → resolve extends → launch session → runFlow → write annotations).
// Per-flow results carry ok / halt-cause / artifact paths. The merged flow's `environment`
// (frozen clock, locale, timezone, viewport, …) is passed into the Playwright session.

import { promises as fs } from "node:fs";
import {
  FlowExecutionError,
  inferHaltCause,
  launchPlaywrightSession,
  loadWorkspaceConfig,
  LocalStorageStateCache,
  parseAuthStrategyFile,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
  runFlow,
  type FlowFile,
  type StorageState,
} from "@docsxai/engine";
import { z } from "zod";
import {
  defineTool,
  fail,
  listFlowFiles,
  loadMergedFlow,
  ok,
  requireWorkspace,
} from "../shared.js";

interface PerFlowResult {
  flow: string;
  ok: boolean;
  stepsExecuted?: string[];
  annotationCount?: number;
  artifacts?: { annotations: string; screenshots: string[] };
  haltStep?: string;
  haltCause?: string;
  error?: string;
}

async function loadAuthStorageState(workspace: string): Promise<StorageState | undefined> {
  const descriptorPath = resolveWorkspacePath(workspace, "auth", "strategy.yaml");
  let text: string;
  try {
    text = await fs.readFile(descriptorPath, "utf8");
  } catch {
    return undefined; // no auth configured — run with a fresh context
  }
  const descriptor = parseAuthStrategyFile(text, descriptorPath);
  const role = descriptor.default_role;
  const state = await new LocalStorageStateCache(resolveWorkspacePath(workspace, ".auth")).load(
    role,
  );
  if (!state) {
    throw new Error(
      `auth/strategy.yaml configures role "${role}" but no valid cached session exists — ` +
        `capture one first (\`docsxai capture-auth\`)`,
    );
  }
  return state;
}

export const runFlowsTool = defineTool({
  name: "run_flows",
  title: "Run the workspace's flows",
  description:
    "Deterministically execute the workspace's flows against the target app (no agent, no LLM): " +
    "screenshots + annotations land under docs/<flow>/. Supports a single-flow filter, " +
    "startFrom/stopAfter prefix runs, attaching to a running Chrome over CDP, and bounded " +
    "parallelism. Per-flow results report ok / halt cause / artifact paths.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    flow: z.string().optional().describe("Run only this flow"),
    startFrom: z
      .string()
      .optional()
      .describe("Skip every step before this id (requires `flow`; browser must be in prior state)"),
    stopAfter: z.string().optional().describe("Run only the prefix up to and incl. this step id"),
    cdp: z
      .string()
      .optional()
      .describe("Attach to a running Chrome at this CDP endpoint instead of launching one"),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .describe("Run up to N flows in parallel (forced to 1 with startFrom/stopAfter/cdp)"),
    baseUrl: z.string().optional().describe("Base URL override (default: .docsxai.json app_url)"),
    headed: z.boolean().optional().describe("Run headed instead of headless"),
    ignoreHttpsErrors: z.boolean().optional(),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    if (args.startFrom && !args.flow) {
      return fail(
        "startFrom requires flow (single-flow calibration aid)",
        "pass `flow` naming the flow to resume",
      );
    }
    const wsCfg = await loadWorkspaceConfig(ws);
    const baseURL = args.baseUrl ?? wsCfg?.app_url;
    const ignoreHTTPSErrors = args.ignoreHttpsErrors ?? !!wsCfg?.ignore_https_errors;

    const flowPaths = await listFlowFiles(ws);
    const flows: FlowFile[] = [];
    for (const fp of flowPaths) {
      const name = fp.replace(/^.*\/([^/]+)\.flow\.yaml$/, "$1");
      const flow = await loadMergedFlow(ws, name);
      if (!args.flow || flow.name === args.flow) flows.push(flow);
    }
    if (flows.length === 0) {
      return fail(
        args.flow ? `no flow named "${args.flow}"` : `no flow-files in ${ws}/flows`,
        args.flow ? "list_flows shows the available flow names" : "calibrate a flow first",
      );
    }

    let storageState: StorageState | undefined;
    try {
      storageState = await loadAuthStorageState(ws);
    } catch (e) {
      return fail((e as Error).message);
    }

    const forceSingle = !!(args.stopAfter || args.startFrom || args.cdp);
    const concurrency = forceSingle ? 1 : (args.concurrency ?? 1);

    const runOne = async (flow: FlowFile): Promise<PerFlowResult> => {
      let session: Awaited<ReturnType<typeof launchPlaywrightSession>>;
      try {
        // With CDP attach, the operator's Chrome owns its auth state — don't overwrite it.
        session = await launchPlaywrightSession({
          ...(baseURL ? { baseURL } : {}),
          ...(args.headed !== undefined ? { headed: args.headed } : {}),
          ignoreHTTPSErrors,
          ...(args.cdp ? { connectOverCdp: args.cdp } : storageState ? { storageState } : {}),
          docPackRoot: ws,
          ...(flow.environment ? { environment: flow.environment } : {}),
        });
      } catch (e) {
        const msg = (e as Error).message;
        const noChromium = /Executable doesn't exist|browserType\.launch|playwright install/i.test(
          msg,
        );
        return {
          flow: flow.name,
          ok: false,
          error: noChromium
            ? "no Chromium binary found — install one: npx playwright-core install chromium (source checkout: pnpm -C packages/engine exec playwright-core install chromium)"
            : `failed to launch browser: ${msg}`,
        };
      }
      try {
        const result = await runFlow(flow, session.driver, {
          resolveLocator: (n) => flow.locators[n],
          ...(args.stopAfter ? { stopAfter: args.stopAfter } : {}),
          ...(args.startFrom ? { startFrom: args.startFrom } : {}),
        });
        await fs.mkdir(resolveWorkspacePath(ws, "docs", flow.name), { recursive: true });
        const annotationsPath = await resolveWorkspacePathReal(
          ws,
          "docs",
          flow.name,
          "annotations.json",
        );
        // startFrom runs only emit the tail steps' annotations — merge them into the existing
        // file by step id so the prior steps' records (and screenshots) stay in place.
        let toWrite = result.annotations;
        if (args.startFrom) {
          try {
            const existing = JSON.parse(
              await fs.readFile(annotationsPath, "utf8"),
            ) as typeof result.annotations;
            const newStepIds = new Set(result.annotations.annotations.map((a) => a.step));
            toWrite = {
              ...result.annotations,
              annotations: [
                ...existing.annotations.filter((a) => !newStepIds.has(a.step)),
                ...result.annotations.annotations,
              ],
            };
          } catch {
            // No existing file — write what we have.
          }
        }
        await fs.writeFile(annotationsPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
        return {
          flow: flow.name,
          ok: true,
          stepsExecuted: result.steps.map((s) => s.id),
          annotationCount: toWrite.annotations.length,
          artifacts: {
            annotations: annotationsPath,
            screenshots: result.steps
              .filter((s) => s.screenshot)
              .map((s) => resolveWorkspacePath(ws, s.screenshot!)),
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          flow: flow.name,
          ok: false,
          ...(e instanceof FlowExecutionError ? { haltStep: e.stepId } : {}),
          ...(inferHaltCause(message) ? { haltCause: inferHaltCause(message)! } : {}),
          error: message,
        };
      } finally {
        await session.close();
      }
    };

    const results: PerFlowResult[] = [];
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < flows.length) {
        const flow = flows[idx++]!;
        results.push(await runOne(flow));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, flows.length) }, () => worker()));
    results.sort((a, b) => a.flow.localeCompare(b.flow));

    return ok({
      workspace: ws,
      allOk: results.every((r) => r.ok),
      concurrency,
      flows: results,
    });
  },
});
