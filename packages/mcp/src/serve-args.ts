// Argument parsing for `docsxai-mcp serve --http ...`. The token is never an argument: any
// `--token...` flag is refused without echoing its value, and unknown arguments are echoed only
// when they look like a flag name, so a secret typed in the wrong place never reaches stderr.

export interface ServeOptions {
  port?: number;
  host?: string;
  allowRemote: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  tokenFile?: string;
  /** Required with --http: every tool path is confined to this directory. */
  workspaceRoot?: string;
}

export interface ParsedServeArgs {
  workspace?: string;
  help: boolean;
  serve: ServeOptions;
}

export const TOKEN_HINT =
  "tokens are never read from arguments: set DOCSX_MCP_TOKEN or pass --token-file <path>";

function takeValue(argv: string[], i: number, flag: string, what: string): string {
  const next = argv[i + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} requires a ${what} value`);
  return next;
}

function parsePort(raw: string): number {
  if (!/^\d{1,5}$/.test(raw) || Number(raw) > 65535) {
    throw new Error("--port requires an integer between 0 and 65535");
  }
  return Number(raw);
}

/** Parse the arguments that follow the `serve` subcommand. */
export function parseServeArgs(argv: string[]): ParsedServeArgs {
  let workspace: string | undefined;
  let help = false;
  let http = false;
  const serve: ServeOptions = { allowRemote: false, allowedHosts: [], allowedOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--http") http = true;
    else if (a === "--allow-remote") serve.allowRemote = true;
    else if (a === "--workspace") workspace = takeValue(argv, i++, a, "<dir>");
    else if (a === "--host") serve.host = takeValue(argv, i++, a, "<host>");
    else if (a === "--port") serve.port = parsePort(takeValue(argv, i++, a, "<port>"));
    else if (a === "--allowed-host") serve.allowedHosts.push(takeValue(argv, i++, a, "<host>"));
    else if (a === "--allowed-origin") {
      serve.allowedOrigins.push(takeValue(argv, i++, a, "<origin>"));
    } else if (a === "--workspace-root") serve.workspaceRoot = takeValue(argv, i++, a, "<dir>");
    else if (a === "--token-file") serve.tokenFile = takeValue(argv, i++, a, "<path>");
    else if (a.startsWith("--token")) throw new Error(TOKEN_HINT);
    else if (a.startsWith("--")) throw new Error(`unknown argument: ${a.split("=")[0]}`);
    else throw new Error("unexpected positional argument");
  }
  if (!help && !http) throw new Error("serve needs a transport: pass --http");
  if (!help && !serve.workspaceRoot) throw new Error("--http requires --workspace-root <dir>");
  return { ...(workspace ? { workspace } : {}), help, serve };
}
