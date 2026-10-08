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
  toFailure,
  ToolInputError,
  WORKSPACE_ARG,
} from "../shared.js";
import { assertBaseUrlAllowed, httpEgressGuard, rejectCdpOverHttp } from "../http-egress.js";

interface PerFlowResult {
  flow: string;
  ok: boolean;
  stepsExecuted?: string[];
  annotationCount?: number;
  artifacts?: { annotations: string; screenshots: string[] };
  haltStep?: string;
  haltCause?: string;
  error?: string;
  /** The next tool call or step for a failed flow. */
  hint?: string;
}

async function loadAuthStorageState(workspace: string): Promise<StorageState | undefined> {
  const descriptorPath = resolveWorkspacePath(workspace, "auth", "strategy.yaml");
  let text: string;
  try {
    text = await fs.readFile(descriptorPath, "utf8");
  } catch {
    return undefined; // no auth configured — run with a fresh context
  }
  let descriptor: ReturnType<typeof parseAuthStrategyFile>;
  try {
    descriptor = parseAuthStrategyFile(text, descriptorPath);
  } catch (e) {
    throw new ToolInputError(
      `auth/strategy.yaml does not parse: ${(e as Error).message}`,
      "fix auth/strategy.yaml, then retry",
    );
  }
  const role = descriptor.default_role;
  const state = await new LocalStorageStateCache(resolveWorkspacePath(workspace, ".auth")).load(
    role,
  );
  if (!state) {
    throw new ToolInputError(
      `auth/strategy.yaml configures role "${role}" but its cached session is missing or expired`,
      "a person has to capture a session: run `docsxai capture-auth <workspace-dir>` on the " +
        "machine that runs docsxai-mcp, then retry",
    );
  }
  return state;
}

export const runFlowsTool = defineTool({
  name: "run_flows",
  title: "Run the workspace's flows",
  description:
    "Run the workspace's flows in a real browser, deterministically (no agent, no LLM). " +
    "Screenshots and annotations.json land under docs/<flow>/ and replace the previous output. " +
    "Use it once lint_flows is clean; narrow it with `flow`, and with `startFrom` / " +
    "`stopAfter` (plus `cdp`) to iterate on one step. Needs the app reachable at `baseUrl` " +
    "(default: app_url in .docsxai.json), a cached login session when auth/strategy.yaml " +
    "exists, and a Chromium binary. Returns { allOk, concurrency, flows }: per flow ok, " +
    "stepsExecuted, annotationCount and artifacts, or on a failure error, hint and, for a halt, " +
    "haltStep and haltCause. Flows with a `matrix:` are reported as failed here; the CLI's " +
    "`--variant` runs them. " +
    "The call returns ok: true even when a flow halted, so check allOk and each " +
    "flows[].ok; for a halt, call diagnose_halt with that flow and haltStep.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    flow: z
      .string()
      .min(1)
      .optional()
      .describe("Run only this flow, by name (default: every flow)"),
    startFrom: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Skip every step before this step id and start there. Requires `flow`. The browser has to be in the state those steps would leave, so pair it with `cdp`.",
      ),
    stopAfter: z
      .string()
      .min(1)
      .optional()
      .describe("Run only the steps up to and including this step id"),
    cdp: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Attach to a running Chrome at this CDP endpoint (e.g. http://localhost:9222) instead of launching one. Refused over HTTP.",
      ),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .describe(
        "Run up to N flows in parallel, 1 to 16 (default 1; forced to 1 with startFrom, stopAfter or cdp)",
      ),
    baseUrl: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Base URL of the running app (default: app_url in .docsxai.json). Over HTTP it has to be a public http(s) address.",
      ),
    headed: z
      .boolean()
      .optional()
      .describe("Show the browser window (default headless; needs a display)"),
    ignoreHttpsErrors: z
      .boolean()
      .optional()
      .describe(
        "Accept self-signed or invalid TLS certificates (default: ignore_https_errors in .docsxai.json)",
      ),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    if (args.startFrom && !args.flow) {
      return fail(
        "startFrom requires flow (single-flow calibration aid)",
        "pass `flow` naming the flow to resume",
      );
    }
    rejectCdpOverHttp(args.cdp, ctx);
    const wsCfg = await loadWorkspaceConfig(ws);
    const baseURL = args.baseUrl ?? wsCfg?.app_url;
    await assertBaseUrlAllowed(baseURL, ctx);
    const egressGuard = httpEgressGuard(ctx);
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
        args.flow
          ? "list_flows shows the available flow names"
          : "write flows/<name>.flow.yaml first (a browser tool such as browxai finds the selectors)",
      );
    }

    if (args.flow) {
      const stepIds = flows[0]!.steps.map((s) => s.id);
      for (const [arg, id] of [
        ["startFrom", args.startFrom],
        ["stopAfter", args.stopAfter],
      ] as const) {
        if (id && !stepIds.includes(id)) {
          return fail(
            `${arg}: no step "${id}" in flow "${args.flow}"`,
            `merged step list: ${stepIds.join(", ")}`,
          );
        }
      }
    }

    let storageState: StorageState | undefined;
    try {
      storageState = await loadAuthStorageState(ws);
    } catch (e) {
      return toFailure(e);
    }

    const forceSingle = !!(args.stopAfter || args.startFrom || args.cdp);
    const concurrency = forceSingle ? 1 : (args.concurrency ?? 1);

    const runOne = async (flow: FlowFile): Promise<PerFlowResult> => {
      if (flow.matrix) {
        return {
          flow: flow.name,
          ok: false,
          error:
            "the flow has a matrix (one run per locale, color scheme and viewport), which " +
            "run_flows does not expand",
          hint:
            "run `docsxai run <workspace-dir> --flow <flow>` on the machine that runs docsxai-mcp; " +
            "add `--variant <id>` for a single variant",
        };
      }
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
          ...(egressGuard ? { egressGuard } : {}),
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
          ...(wsCfg?.annotations?.obstacles === true ? { obstacles: true } : {}),
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
          ...(e instanceof FlowExecutionError
            ? {
                hint: `diagnose_halt with flow "${flow.name}" and step "${e.stepId}" explains the halt`,
              }
            : {}),
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

    const allOk = results.every((r) => r.ok);
    return ok({
      workspace: ws,
      allOk,
      concurrency,
      flows: results,
      ...(allOk
        ? {}
        : { hint: "read flows[].error and flows[].hint for each flow with ok: false" }),
    });
  },
});
