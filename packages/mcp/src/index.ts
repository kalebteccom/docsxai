// @docsxai/mcp
// Standalone MCP server over the docsxai engine (stdio, plus an opt-in Streamable HTTP
// transport): calibration meta-orchestration (init / run / render / lint / diagnose / style /
// zip / push / pull) + read-only doc-pack introspection (list flows, flow tree, annotations,
// artifact paths, plugins). No browser primitives — live-page discovery is browxai's surface.

export const name = "@docsxai/mcp";

export {
  createDocsxaiMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TOOL_DEFINITIONS,
  type CreateDocsxaiMcpServerOptions,
} from "./server.js";
export { parseBinArgs } from "./bin.js";
export { startHttpServer, type HttpServerOptions, type RunningHttpServer } from "./http-server.js";
export { resolveToken, TOKEN_ENV_VAR, MIN_TOKEN_LENGTH } from "./http-auth.js";
export type { ToolContext, ToolDefinition, ToolFail, ToolOk, ToolResult } from "./shared.js";
