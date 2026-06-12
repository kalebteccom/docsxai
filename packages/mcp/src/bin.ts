#!/usr/bin/env node
// `docsxai-mcp` — stdio entry point. Logs go to stderr; stdout is the MCP wire.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDocsxaiMcpServer } from "./server.js";

const USAGE = `docsxai-mcp — stdio MCP server over the docsxai engine

Usage:
  docsxai-mcp [--workspace <dir>]

Options:
  --workspace <dir>   Default site-docs workspace for tool calls that omit \`workspace\`.
  --help              Show this message.
`;

export function parseBinArgs(argv: string[]): { workspace?: string; help: boolean } {
  let workspace: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--workspace") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--workspace requires a <dir> value");
      workspace = next;
      i++;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { ...(workspace ? { workspace } : {}), help };
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseBinArgs>;
  try {
    parsed = parseBinArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`docsxai-mcp: ${(e as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (parsed.help) {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  const server = createDocsxaiMcpServer(
    parsed.workspace ? { defaultWorkspace: parsed.workspace } : {},
  );
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `docsxai-mcp: listening on stdio${parsed.workspace ? ` (default workspace: ${parsed.workspace})` : ""}\n`,
  );
}

// Run as the bin entry, but not when imported (e.g. in tests).
if (process.argv[1] && /bin\.(js|ts)$/.test(process.argv[1])) {
  main().catch((e: unknown) => {
    process.stderr.write(`docsxai-mcp: fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
