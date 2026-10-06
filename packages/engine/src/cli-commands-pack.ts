// Screenshot-pack commands — `pack` builds the hash-named, optimised PNG set plus manifest.json a
// docs site or README consumes, and `drift` rebuilds it in memory and compares it with the
// committed pack. The logic lives in `@docsxai/viewer` (it owns the burner); like `burn`, these
// validate the argv edge and run the viewer's command through the shared bin resolution, so the
// engine still does not depend on the viewer.

import { USAGE } from "./cli-usage.js";
import { runViewerBin } from "./viewer-bin.js";

interface FlagSpec {
  /** Flags that take a value. */
  valued: string[];
  /** Flags that stand alone. */
  bare: string[];
}

/** Parse argv against a spec. Returns the argv to pass on (flags in the order given) or the usage-error message. */
function checkArgs(args: string[], spec: FlagSpec): { dir: string; rest: string[] } | string {
  const rest: string[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (spec.bare.includes(a)) {
      rest.push(a);
    } else if (spec.valued.includes(a)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) return `${a} needs a value`;
      rest.push(a, value);
    } else if (a.startsWith("--")) {
      return `unknown flag ${a}`;
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length === 0) return "missing <workspace-or-raw-dir>";
  if (positionals.length > 1) return `unexpected argument "${positionals[1]}"`;
  return { dir: positionals[0]!, rest };
}

function usageError(command: string, message: string): number {
  process.stderr.write(`${command}: ${message}\n\n${USAGE}\n`);
  return 2;
}

/** `pack` — burn, optimise, hash-name and write the screenshot pack. */
export async function cmdPack(args: string[]): Promise<number> {
  const parsed = checkArgs(args, {
    valued: ["--out", "--public-prefix", "--generated-for"],
    bare: ["--from-raw", "--no-optimise"],
  });
  if (typeof parsed === "string") return usageError("pack", parsed);
  return runViewerBin("pack", ["pack", parsed.dir, ...parsed.rest]);
}

/** `drift` — rebuild the pack in memory and compare it with the committed one. */
export async function cmdDrift(args: string[]): Promise<number> {
  const parsed = checkArgs(args, { valued: ["--against", "--threshold"], bare: ["--from-raw"] });
  if (typeof parsed === "string") return usageError("drift", parsed);
  const against = parsed.rest.indexOf("--against");
  if (against === -1) return usageError("drift", "--against <pack-dir> is required");
  const pct = parsed.rest.indexOf("--threshold");
  if (pct !== -1) {
    const value = Number(parsed.rest[pct + 1]);
    if (!Number.isFinite(value) || value < 0) {
      return usageError("drift", "--threshold needs a percentage >= 0");
    }
  }
  return runViewerBin("drift", ["drift", parsed.dir, ...parsed.rest]);
}
