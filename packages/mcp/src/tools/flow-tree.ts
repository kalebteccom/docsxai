// flow_tree — the workspace's extends graph (roots, descendants, orphans, resolution issues).

import { buildFlowTree } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, loadFlowsByName, ok, requireWorkspace } from "../shared.js";

export const flowTreeTool = defineTool({
  name: "flow_tree",
  title: "Show the flow extends graph",
  description:
    "Build the workspace's flow `extends` graph: root flows + descendants, orphans (parent not " +
    "in the workspace), and resolution issues (cycles / step-id collisions). Pure-static.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const flowsByName = await loadFlowsByName(ws);
    const tree = await buildFlowTree(flowsByName);
    return ok({
      workspace: ws,
      roots: tree.roots,
      orphans: tree.orphans,
      issues: tree.issues,
      clean: tree.issues.length === 0 && tree.orphans.length === 0,
    });
  },
});
