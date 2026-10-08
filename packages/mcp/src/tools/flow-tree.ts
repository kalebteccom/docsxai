// flow_tree — the workspace's extends graph (roots, descendants, orphans, resolution issues).

import { buildFlowTree } from "@docsxai/engine";
import { defineTool, loadFlowsByName, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const flowTreeTool = defineTool({
  name: "flow_tree",
  title: "Show the flow extends graph",
  description:
    "Show how the workspace's flows `extends` each other. Use it before editing a parent flow " +
    "(to see which flows inherit from it) or when lint_flows or run_flows reports an `extends` " +
    "problem. Returns { roots, orphans, issues, clean }: root flows with their descendants, " +
    "flows whose parent is not in the workspace, and resolution issues (cycles, step-id " +
    "collisions). `clean` is true when there are no orphans and no issues. Static: no browser. " +
    "Fails with a parse error naming the flow-file that does not parse.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
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
