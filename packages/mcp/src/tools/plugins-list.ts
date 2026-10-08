// plugins_list — resolve + load the workspace's configured plugins and report each one's status.

import { readPluginsLock, readWorkspacePluginsConfig, resolvePlugins } from "@docsxai/engine";
import { defineTool, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const pluginsListTool = defineTool({
  name: "plugins_list",
  title: "List workspace plugins",
  description:
    "Show which plugins the workspace configures and whether each one loaded. Use it when a " +
    "publisher, renderer or lint rule you expect is missing. Reads .docsxai.json `plugins` and " +
    "`plugin_capabilities`, resolves them and returns { configured, loaded, plugins }: per " +
    "plugin the name, version, source, trust, status (with statusReason when it did not load) " +
    "and the artifacts it registered. `configured` is 0 for a workspace with no plugins.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
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
