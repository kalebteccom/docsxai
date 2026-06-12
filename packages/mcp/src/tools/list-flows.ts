// list_flows — read-only doc-pack introspection: every flow's name, steps, extends parent,
// and a one-look summary of its pinned execution environment.

import * as path from "node:path";
import { z } from "zod";
import { defineTool, loadFlowsByName, ok, requireWorkspace } from "../shared.js";

export const listFlowsTool = defineTool({
  name: "list_flows",
  title: "List the workspace's flows",
  description:
    "List every flow-file in the workspace: name, step ids/actions, extends parent, and the " +
    "pinned environment summary (locale/timezone/viewport/clock/color-scheme/reduced-motion).",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
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
