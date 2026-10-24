// Shared CLI leaf — the helpers more than one command cluster reaches for. Kept dependency-free of
// the command clusters (and of cli.ts) so it can be imported anywhere without a cycle: the clusters
// import from here; this file imports only from the engine's lower-level modules.
//   • parseFlags    — the argv → { positionals, flags } parser every command opens with
//   • claimFlowName — reject two flow files that declare one `name:`
//   • listFlowFiles — enumerate the workspace's flows/*.flow.yaml (run / lint / flow-tree)

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { shellQuote, usageError, withNext } from "./cli-messages.js";
import { resolveWorkspacePath, WORKSPACE_CONFIG_FILE } from "./workspace.js";

/**
 * Split argv into positionals and `--flag [value]` / `--flag=value` pairs. A flag in `bool` never
 * takes the next argument as its value. `repeated` lists the flags given more than once and
 * `boolWithValue` the `bool` flags given as `--flag=value`; the caller turns either into a usage error.
 */
export function parseFlags(
  args: string[],
  bool: readonly string[] = [],
): {
  positionals: string[];
  flags: Map<string, string | true>;
  repeated: string[];
  boolWithValue: string[];
} {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const repeated: string[] = [];
  const boolWithValue: string[] = [];
  const set = (key: string, value: string | true): void => {
    if (flags.has(key) && !repeated.includes(key)) repeated.push(key);
    flags.set(key, value);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        const key = a.slice(2, eq);
        if (bool.includes(key)) boolWithValue.push(key);
        set(key, a.slice(eq + 1));
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (!bool.includes(key) && next !== undefined && !next.startsWith("--")) {
        set(key, next);
        i++;
      } else {
        set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, repeated, boolWithValue };
}

/** True when `value` parses as an `http:` or `https:` URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A URL `docsxai run` can open: http(s), or file: for a local static site. */
export function isRunnableUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:" || isHttpUrl(value);
  } catch {
    return false;
  }
}

/** The first of `names` given as a bare flag (`--flow` with nothing after it), or `undefined`. */
export function flagMissingValue(
  flags: Map<string, string | true>,
  names: readonly string[],
): string | undefined {
  return names.find((n) => flags.get(n) === true);
}

/**
 * Exit code 2 (after the usage error) when any of `names` was given as a bare flag, else
 * `undefined`. A value flag with nothing after it would otherwise fall back to its default.
 */
export function bareValueFlagExit(
  label: string,
  flags: Map<string, string | true>,
  names: readonly string[],
): number | undefined {
  const bare = flagMissingValue(flags, names);
  return bare ? usageError(label, `--${bare} needs a value`) : undefined;
}

/**
 * Record that `file` declares the flow `name` in `owners`. Returns the error text when an earlier
 * file already declared it: two files with one `name:` write to one `docs/<name>/` directory.
 */
export function claimFlowName(
  owners: Map<string, string>,
  name: string,
  file: string,
): string | undefined {
  const first = owners.get(name);
  if (first === undefined) {
    owners.set(name, file);
    return undefined;
  }
  return `flow name "${name}" is declared by both ${first} and ${file}; each flow needs its own name`;
}

/** Why `projectDir` has no flows/ to list, with the one command that fixes it. */
async function missingFlowsMessage(projectDir: string, flowsDir: string): Promise<string> {
  const dir = shellQuote(projectDir);
  let entries: string[] | undefined;
  try {
    entries = await fs.readdir(path.resolve(projectDir));
  } catch {
    entries = undefined;
  }
  if (entries?.includes(WORKSPACE_CONFIG_FILE)) {
    return withNext(
      `workspace ${projectDir} has no flows/ directory (expected ${flowsDir})`,
      `mkdir ${shellQuote(flowsDir)}  (then docsxai calibrate ${dir} --from <flow.yaml>)`,
    );
  }
  if (entries && entries.length > 0) {
    return withNext(
      `${projectDir} is not a docsxai workspace (no ${WORKSPACE_CONFIG_FILE}, no flows/)`,
      "docsxai init <new-dir>, or pass the workspace directory",
    );
  }
  return withNext(
    `workspace ${projectDir} has no flows/ directory (expected ${flowsDir}); it is not a docsxai workspace`,
    `docsxai init ${dir}  (or fix the path; init needs a new or empty directory)`,
  );
}

/**
 * Why `projectDir` cannot be a workspace at all: it does not exist, or it is a file. `undefined` when
 * it is a directory (an empty one included). Commands that write into the workspace call this first,
 * so a mistyped path fails instead of creating the directory.
 */
export async function workspaceDirProblem(projectDir: string): Promise<string | undefined> {
  const stat = await fs.stat(path.resolve(projectDir)).catch(() => null);
  if (stat?.isDirectory()) return undefined;
  if (stat) {
    return withNext(
      `${projectDir} is a file, not a workspace directory`,
      "docsxai init <new-dir>, or pass the workspace directory",
    );
  }
  return withNext(
    `workspace doesn't exist: ${projectDir}`,
    `docsxai init ${shellQuote(projectDir)}  (or fix the path)`,
  );
}

export async function listFlowFiles(projectDir: string): Promise<string[]> {
  const dir = resolveWorkspacePath(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(await missingFlowsMessage(projectDir, dir));
  }
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .sort()
    .map((e) => resolveWorkspacePath(projectDir, "flows", e));
}
