// @kalebtec/docsxai-mcp
// Standalone stdio MCP server over the docsxai engine: calibration meta-orchestration
// (init / run / render / lint / diagnose / style / zip / push / pull) + read-only doc-pack
// introspection (list flows, flow tree, annotations, artifact paths, plugins). No browser
// primitives — live-page discovery is browxai's surface.

export const name = "@kalebtec/docsxai-mcp";

export {
  createDocsxaiMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TOOL_DEFINITIONS,
  type CreateDocsxaiMcpServerOptions,
} from "./server.js";
export { parseBinArgs } from "./bin.js";
export type { ToolContext, ToolDefinition, ToolFail, ToolOk, ToolResult } from "./shared.js";
