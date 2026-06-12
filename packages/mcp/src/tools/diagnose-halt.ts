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
import { defineTool, fail, loadMergedFlow, ok, requireWorkspace } from "../shared.js";

export const diagnoseHaltTool = defineTool({
  name: "diagnose_halt",
  title: "Diagnose a halted step",
  description:
    "Gather halt context for a flow step: resolved selector, wait_for/success spec, the halt " +
    "screenshot path if one exists, and (with `cdp`) a live actionable() probe on the running " +
    "page. Returns recommendations (selector / wait_for / success / annotation_target / " +
    "split_step / investigate); never edits the flow-file.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    flow: z.string().min(1).describe("Flow name"),
    step: z.string().min(1).describe("Step id within the (merged) flow"),
    cdp: z
      .string()
      .optional()
      .describe("CDP endpoint of a running Chrome to live-probe (e.g. http://localhost:9222)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const flow = await loadMergedFlow(ws, args.flow);
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
        `live probe failed: ${(e as Error).message}`,
        "is Chrome running with --remote-debugging-port at that endpoint?",
      );
    } finally {
      if (liveSession) await liveSession.close();
    }

    return ok({ workspace: ws, report });
  },
});
