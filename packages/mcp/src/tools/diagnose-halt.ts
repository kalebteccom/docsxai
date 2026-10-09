// diagnose_halt — gather halt context for one step (selector, wait_for, success, halt screenshot,
// and — with a CDP endpoint — a live actionable() probe) and return recommendations. The engine
// never patches the flow-file; acting on a recommendation is the host agent's explicit step.

import {
  buildDiagnoseReport,
  launchPlaywrightSession,
  probeLive,
  resolveWorkspacePath,
  type DiagnoseReport,
} from "@docsxai/engine";
import { z } from "zod";
import { rejectCdpOverHttp } from "../http-egress.js";
import {
  defineTool,
  fail,
  loadMergedFlow,
  ok,
  requireWorkspace,
  WORKSPACE_ARG,
} from "../shared.js";

export const diagnoseHaltTool = defineTool({
  name: "diagnose_halt",
  title: "Diagnose a halted step",
  description:
    "Explain why one step of a flow halted. Use it after run_flows reports a halt, with that " +
    "result's flow and haltStep. Returns { report }: the resolved selector, the wait_for and " +
    "success specs, the halt screenshot path if one exists, and typed recommendations " +
    "(selector, wait_for, success, annotation_target, split_step, investigate). With `cdp` it " +
    "also probes the selector live on a running Chrome. Read-only: it never edits the " +
    "flow-file, so apply a recommendation by editing the flow yourself. Fails with the merged " +
    "step ids when the step does not exist. Flows with a `matrix:` are refused; the CLI's " +
    "`diagnose --variant` handles them.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    flow: z.string().min(1).describe("Flow name, as list_flows reports it"),
    step: z
      .string()
      .min(1)
      .describe(
        "Step id in the merged flow (after `extends` is resolved), e.g. haltStep from run_flows",
      ),
    cdp: z
      .string()
      .min(1)
      .optional()
      .describe(
        "CDP endpoint of a running Chrome to probe live, e.g. http://localhost:9222. Refused over HTTP.",
      ),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    rejectCdpOverHttp(args.cdp, ctx);
    const flow = await loadMergedFlow(ws, args.flow);
    if (flow.matrix) {
      return fail(
        `flow "${args.flow}" has a matrix, so each variant has its own steps and halt screenshot`,
        "run `docsxai diagnose <workspace-dir> --flow <flow> --step <step> --variant <id>` " +
          "on the machine that runs docsxai-mcp (`docsxai flow-tree <workspace-dir>` lists the variant ids)",
      );
    }
    const step = flow.steps.find((s) => s.id === args.step);
    if (!step) {
      return fail(
        `no step "${args.step}" in flow "${args.flow}"`,
        `merged step list: ${flow.steps.map((s) => s.id).join(", ")}`,
      );
    }

    const resolvedSelector = step.target
      ? step.target.startsWith("$")
        ? (flow.locators[step.target.slice(1)] ?? step.target)
        : step.target
      : undefined;
    const haltScreenshotAbsPath = resolveWorkspacePath(
      ws,
      "docs",
      args.flow,
      "halts",
      `${args.step}.png`,
    );

    let liveSession: Awaited<ReturnType<typeof launchPlaywrightSession>> | undefined;
    const liveProbe =
      args.cdp && resolvedSelector
        ? async () => {
            liveSession = await launchPlaywrightSession({
              connectOverCdp: args.cdp!,
              docPackRoot: ws,
            });
            return probeLive(liveSession.driver, resolvedSelector, args.cdp!);
          }
        : undefined;

    let report: DiagnoseReport;
    try {
      report = await buildDiagnoseReport({
        workspace: ws,
        flow,
        step,
        ...(resolvedSelector ? { resolvedSelector } : {}),
        haltScreenshotAbsPath,
        ...(liveProbe ? { liveProbe } : {}),
      });
    } catch (e) {
      return fail(
        `${args.cdp ? "live probe failed" : "diagnose failed"}: ${(e as Error).message}`,
        args.cdp
          ? "check that Chrome runs with --remote-debugging-port and `cdp` points at it, or leave `cdp` out for the static report"
          : "check that the flow-files parse (lint_flows) and retry",
      );
    } finally {
      if (liveSession) await liveSession.close();
    }

    return ok({ workspace: ws, report });
  },
});
