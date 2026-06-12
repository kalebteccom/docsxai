// plugins_list — resolve + load the workspace's configured plugins and report each one's status.

import {
  readPluginsLock,
  readWorkspacePluginsConfig,
  resolvePlugins,
} from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, ok, requireWorkspace } from "../shared.js";

export const pluginsListTool = defineTool({
  name: "plugins_list",
  title: "List workspace plugins",
  description:
    "Resolve and load the workspace's configured plugin set (.site-docs.json `plugins` + " +
    "`plugin_capabilities`) and report each plugin's status, trust, and registered artifacts.",
  inputSchema: {
    workspace: z.string().optional().describe("Workspace dir (defaults to the server's --workspace)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const cfg = await readWorkspacePluginsConfig(ws);
    const lock = await readPluginsLock(ws);
    const registry = await resolvePlugins({
      workspaceDir: ws,
      sources: cfg.sources,
      enabledCapabilities: cfg.capabilities,
      lock,
    });
    const records = registry.listPlugins();
    return ok({
      workspace: ws,
      configured: records.length,
      loaded: records.filter((r) => r.status === "loaded").length,
      plugins: records.map((r) => ({
        name: r.name,
        version: r.version,
        namespace: r.namespace,
        source: r.source,
        trust: r.trust,
        status: r.status,
        ...(r.statusReason ? { statusReason: r.statusReason } : {}),
        artifacts: r.artifacts,
      })),
    });
  },
});
