#!/usr/bin/env node
// `docsxai-mcp` — stdio entry point. Logs go to stderr; stdout is the MCP wire.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveToken } from "./http-auth.js";
import { startHttpServer } from "./http-server.js";
import { createDocsxaiMcpServer } from "./server.js";
import { parseServeArgs, TOKEN_HINT, type ServeOptions } from "./serve-args.js";

const USAGE = `docsxai-mcp — stdio MCP server over the docsxai engine

Usage:
  docsxai-mcp [--workspace <dir>]
  docsxai-mcp serve --http [--port <n>] [--host <host>] [--token-file <path>]
                           [--allowed-host <host>]... [--allow-remote] [--workspace <dir>]

Options:
  --workspace <dir>   Default docsxai workspace for tool calls that omit \`workspace\`.
  --help              Show this message.

Streamable HTTP (opt-in, loopback by default):
  --http              Serve MCP over HTTP at /mcp instead of stdio.
  --port <n>          Port to listen on (default 8765).
  --host <host>       Interface to bind (default 127.0.0.1).
  --token-file <path> File holding the bearer token. Otherwise DOCSX_MCP_TOKEN is read.
                      The token is required and must be at least 32 characters.
  --allowed-host <h>  Extra hostname accepted in Host and Origin headers. Repeatable.
  --allow-remote      Required to bind a non-loopback host. Terminate TLS in front of the server.
`;

export interface ParsedBinArgs {
  workspace?: string;
  help: boolean;
  /** Present only for `serve --http`. */
  serve?: ServeOptions;
}

export function parseBinArgs(argv: string[]): ParsedBinArgs {
  if (argv[0] === "serve") return parseServeArgs(argv.slice(1));
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
    } else if (a.startsWith("--token")) {
      throw new Error(TOKEN_HINT);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { ...(workspace ? { workspace } : {}), help };
}

async function serveHttp(serve: ServeOptions, workspace: string | undefined): Promise<void> {
  const token = resolveToken({
    env: process.env,
    ...(serve.tokenFile ? { tokenFile: serve.tokenFile } : {}),
  });
  const running = await startHttpServer({
    token,
    allowRemote: serve.allowRemote,
    allowedHosts: serve.allowedHosts,
    ...(serve.host ? { host: serve.host } : {}),
    ...(serve.port !== undefined ? { port: serve.port } : {}),
    ...(workspace ? { defaultWorkspace: workspace } : {}),
    log: (line) => process.stderr.write(`docsxai-mcp: ${line}\n`),
  });
  process.stderr.write(`docsxai-mcp: listening on ${running.url} (bearer token required)\n`);
  if (serve.allowRemote) {
    process.stderr.write(
      "docsxai-mcp: remote bind enabled; terminate TLS in front of this server\n",
    );
  }
  const stop = (): void => {
    void running.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main(): Promise<void> {
  let parsed: ParsedBinArgs;
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
  if (parsed.serve) {
    await serveHttp(parsed.serve, parsed.workspace);
    return;
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
