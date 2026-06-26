// Shared CLI leaf — the helpers more than one command cluster reaches for. Kept dependency-free of
// the command clusters (and of cli.ts) so it can be imported anywhere without a cycle: the clusters
// import from here; this file imports only from the engine's lower-level modules.
//   • parseFlags    — the argv → { positionals, flags } parser every command opens with
//   • listFlowFiles — enumerate the workspace's flows/*.flow.yaml (run / lint / flow-tree)

import { promises as fs } from "node:fs";
import { resolveWorkspacePath } from "./workspace.js";

export function parseFlags(args: string[]): {
  positionals: string[];
  flags: Map<string, string | true>;
} {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export async function listFlowFiles(projectDir: string): Promise<string[]> {
  const dir = resolveWorkspacePath(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(
      `workspace ${projectDir} has no flows/ directory (expected ${dir}). ` +
        `Is this a docsxai workspace? Create one with \`docsxai init <workspace-dir>\`, ` +
        `then add flows via \`docsxai calibrate\` or by writing flows/<name>.flow.yaml.`,
    );
  }
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .sort()
    .map((e) => resolveWorkspacePath(projectDir, "flows", e));
}
