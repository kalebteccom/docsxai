// lint_flows — pure-static lint over the workspace's flow-files, including plugin-contributed
// extra rules when the workspace's plugin set resolves (plugin failures degrade to a warning,
// never fail the lint itself).

import {
  lintFlow,
  readPluginsLock,
  readWorkspacePluginsConfig,
  resolvePlugins,
  type LintIssue,
  type LintRule,
} from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, fail, loadFlowsByName, ok, requireWorkspace } from "../shared.js";

export const lintFlowsTool = defineTool({
  name: "lint_flows",
  title: "Lint the workspace's flows",
  description:
    "Run the static lint rules (R001 deep extends chain, R002 unmounting annotation target, " +
    "R003 missing wait timeout on long-async steps, R004 bare data-attribute selector, …) plus " +
    "any plugin-contributed rules across the workspace's flow-files. No browser, no live page.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    flow: z.string().optional().describe("Lint only this flow (default: every flow)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const flowsByName = await loadFlowsByName(ws);

    const targets = args.flow
      ? flowsByName.has(args.flow)
        ? [flowsByName.get(args.flow)!]
        : []
      : [...flowsByName.values()];
    if (args.flow && targets.length === 0) {
      return fail(
        `flow not found: ${args.flow}`,
        `available flows: ${[...flowsByName.keys()].join(", ") || "(none)"}`,
      );
    }

    // Plugin extraRules — best-effort: an unresolvable plugin set must not block a static lint.
    let extraRules: LintRule[] = [];
    let pluginRuleWarning: string | undefined;
    try {
      const cfg = await readWorkspacePluginsConfig(ws);
      if (cfg.sources.length > 0) {
        const lock = await readPluginsLock(ws);
        const registry = await resolvePlugins({
          workspaceDir: ws,
          sources: cfg.sources,
          enabledCapabilities: cfg.capabilities,
          lock,
        });
        extraRules = registry.getLintRules();
      }
    } catch (e) {
      pluginRuleWarning = `plugin lint rules unavailable: ${(e as Error).message}`;
    }

    const loadFlow = (name: string) => {
      const f = flowsByName.get(name);
      if (!f) throw new Error(`extends target not found: ${name}`);
      return f;
    };

    const issues: LintIssue[] = [];
    for (const flow of targets) {
      issues.push(
        ...(await lintFlow(flow, {
          loadFlow,
          ...(extraRules.length ? { extraRules } : {}),
        })),
      );
    }

    return ok({
      workspace: ws,
      flowsLinted: targets.map((f) => f.name),
      pluginRuleCount: extraRules.length,
      ...(pluginRuleWarning ? { pluginRuleWarning } : {}),
      issues,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        infos: issues.filter((i) => i.severity === "info").length,
      },
      clean: !issues.some((i) => i.severity === "error" || i.severity === "warning"),
    });
  },
});
