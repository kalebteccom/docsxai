// The docsxai MCP server — composes the tool registry. This file is the ONLY place tools are
// registered; each tool lives in its own file under src/tools/ and exports a ToolDefinition.
//
// Boundary (load-bearing): calibration meta-orchestration + read-only doc-pack introspection
// ONLY. No browser primitives are exposed here — live-page discovery (click/fill/inspect on an
// arbitrary page) is browxai's surface, not this server's.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { diagnoseHaltTool } from "./tools/diagnose-halt.js";
import { flowTreeTool } from "./tools/flow-tree.js";
import { getAnnotationsTool } from "./tools/get-annotations.js";
import { getRunArtifactsTool } from "./tools/get-run-artifacts.js";
import { initWorkspaceTool } from "./tools/init-workspace.js";
import { lintFlowsTool } from "./tools/lint-flows.js";
import { listFlowsTool } from "./tools/list-flows.js";
import { pluginsListTool } from "./tools/plugins-list.js";
import { pullPackTool } from "./tools/pull-pack.js";
import { pushPackTool } from "./tools/push-pack.js";
import { renderViewerTool } from "./tools/render-viewer.js";
import { runFlowsTool } from "./tools/run-flows.js";
import { styleCheckTool } from "./tools/style-check.js";
import { zipPackTool } from "./tools/zip-pack.js";
import { toFailure, type ToolContext, type ToolDefinition, type ToolResult } from "./shared.js";

export const SERVER_NAME = "docsxai-mcp";
export const SERVER_VERSION = "0.1.0";

/** Every tool the server exposes, in registration order. Composed here and nowhere else. */
export const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = [
  initWorkspaceTool,
  runFlowsTool,
  renderViewerTool,
  lintFlowsTool,
  flowTreeTool,
  diagnoseHaltTool,
  styleCheckTool,
  zipPackTool,
  pushPackTool,
  pullPackTool,
  listFlowsTool,
  getAnnotationsTool,
  getRunArtifactsTool,
  pluginsListTool,
];

export interface CreateDocsxaiMcpServerOptions {
  /** Default workspace dir (`--workspace <dir>` on the bin); used when a call omits `workspace`. */
  defaultWorkspace?: string;
}

/** Build the MCP server with every tool registered. The caller connects it to a transport. */
export function createDocsxaiMcpServer(opts: CreateDocsxaiMcpServerOptions = {}): McpServer {
  const ctx: ToolContext = {
    ...(opts.defaultWorkspace ? { defaultWorkspace: opts.defaultWorkspace } : {}),
  };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const seen = new Set<string>();
  for (const def of TOOL_DEFINITIONS) {
    if (seen.has(def.name)) throw new Error(`duplicate tool name: ${def.name}`);
    seen.add(def.name);
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema },
      async (args: Record<string, unknown>) => {
        let result: ToolResult;
        try {
          result = await def.handler(args ?? {}, ctx);
        } catch (e) {
          result = toFailure(e);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          ...(result.ok ? {} : { isError: true }),
        };
      },
    );
  }
  return server;
}
