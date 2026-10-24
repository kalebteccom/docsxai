// Shared CLI leaf — the helpers more than one command cluster reaches for. Kept dependency-free of
// the command clusters (and of cli.ts) so it can be imported anywhere without a cycle: the clusters
// import from here; this file imports only from the engine's lower-level modules.
//   • parseFlags    — the argv → { positionals, flags } parser every command opens with
//   • listFlowFiles — enumerate the workspace's flows/*.flow.yaml (run / lint / flow-tree)

import { promises as fs } from "node:fs";
import { shellQuote, withNext } from "./cli-messages.js";
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
      const eq = a.indexOf("=");
      if (eq > 2) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
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

/** The first of `names` given as a bare flag (`--flow` with nothing after it), or `undefined`. */
export function flagMissingValue(
  flags: Map<string, string | true>,
  names: readonly string[],
): string | undefined {
  return names.find((n) => flags.get(n) === true);
}

export async function listFlowFiles(projectDir: string): Promise<string[]> {
  const dir = resolveWorkspacePath(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(
      withNext(
        `workspace ${projectDir} has no flows/ directory (expected ${dir}); it is not a docsxai workspace`,
        `docsxai init ${shellQuote(projectDir)}  (or fix the path; init needs a new or empty directory)`,
      ),
    );
  }
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .sort()
    .map((e) => resolveWorkspacePath(projectDir, "flows", e));
}
