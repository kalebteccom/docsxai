// list_flows — read-only doc-pack introspection: every flow's name, steps, extends parent,
// and a one-look summary of its pinned execution environment.

import * as path from "node:path";
import { defineTool, loadFlowsByName, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const listFlowsTool = defineTool({
  name: "list_flows",
  title: "List the workspace's flows",
  description:
    "List the workspace's flows. Use it first to learn the flow names and step ids that " +
    "run_flows, diagnose_halt and get_annotations take. Returns { flows }: per flow the name, " +
    "file, `extends` parent, step ids with their actions (and which are optional), and the " +
    "pinned environment (locale, timezone, viewport, clock, color scheme, reduced motion). " +
    "Reads flow-files only. `flows` is empty when none exist yet. Fails with a parse error " +
    "naming the flow-file that does not parse.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const flowsByName = await loadFlowsByName(ws);
    const flows = [...flowsByName.values()].map((flow) => ({
      name: flow.name,
      file: path.join("flows", `${flow.name}.flow.yaml`),
      ...(flow.extends ? { extends: flow.extends } : {}),
      stepCount: flow.steps.length,
      steps: flow.steps.map((s) => ({
        id: s.id,
        action: s.action,
        ...(s.optional ? { optional: true } : {}),
      })),
      ...(flow.environment
        ? {
            environment: {
              ...(flow.environment.locale ? { locale: flow.environment.locale } : {}),
              ...(flow.environment.timezone ? { timezone: flow.environment.timezone } : {}),
              ...(flow.environment.viewport ? { viewport: flow.environment.viewport } : {}),
              ...(flow.environment.clock ? { clock: flow.environment.clock } : {}),
              ...(flow.environment.color_scheme
                ? { color_scheme: flow.environment.color_scheme }
                : {}),
              ...(flow.environment.reduced_motion !== undefined
                ? { reduced_motion: flow.environment.reduced_motion }
                : {}),
            },
          }
        : {}),
    }));
    return ok({ workspace: ws, flows });
  },
});
