// Argument parsing for the `docsxai-backend` bin. Strict on purpose: a mistyped `--data-dir` that
// was ignored would start an in-memory server the operator believes is persistent.

export const CLI_USAGE = "usage: docsxai-backend [--port=<0-65535>] [--data-dir=<dir>]";
export const DEFAULT_PORT = 4477;

export type CliParse =
  | { ok: true; port: number; dataDir: string | undefined }
  | { ok: false; message: string };

/** Value of `--name=<v>` or `--name <v>` at `argv[i]`; `undefined` when `argv[i]` is another flag. */
function flagValue(
  argv: string[],
  i: number,
  name: string,
): { value: string | undefined; next: number } | undefined {
  const arg = argv[i]!;
  if (arg.startsWith(`${name}=`)) return { value: arg.slice(name.length + 1), next: i };
  if (arg !== name) return undefined;
  const following = argv[i + 1];
  if (following === undefined || following.startsWith("--")) return { value: undefined, next: i };
  return { value: following, next: i + 1 };
}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv): CliParse {
  let portArg: string | undefined;
  let dirArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const port = flagValue(argv, i, "--port");
    if (port) {
      if (!port.value) return { ok: false, message: "--port needs a value" };
      portArg = port.value;
      i = port.next;
      continue;
    }
    const dir = flagValue(argv, i, "--data-dir");
    if (dir) {
      if (!dir.value) return { ok: false, message: "--data-dir needs a value" };
      dirArg = dir.value;
      i = dir.next;
      continue;
    }
    return { ok: false, message: `unknown argument "${argv[i]}"` };
  }
  const rawPort = portArg ?? (env.PORT || String(DEFAULT_PORT));
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!(port >= 0 && port <= 65535)) {
    return { ok: false, message: `invalid port "${rawPort}" (expected 0-65535)` };
  }
  return { ok: true, port, dataDir: dirArg ?? (env.DOCSX_DATA_DIR || undefined) };
}
