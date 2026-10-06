// `docsxai-viewer pack` and `docsxai-viewer drift`: argv parsing and the two command bodies. The
// logic is in pack-build.ts (burn, optimise, hash, manifest), pack-write.ts (files, pruning) and
// pack-drift.ts (comparison); this file wires them to a directory and an exit code.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { buildPack } from "./pack-build.js";
import { computeDrift, DEFAULT_THRESHOLD_PCT } from "./pack-drift.js";
import { createOxipngOptimiser, identityOptimiser, oxipngCommand } from "./pack-optimise.js";
import { DEFAULT_PUBLIC_PREFIX } from "./pack-schema.js";
import { readRawCapture, type PackSource } from "./pack-source.js";
import { PACK_CONFIG_FILE, readWorkspace } from "./pack-workspace.js";
import { writePack } from "./pack-write.js";

export const PACK_SYNOPSIS = `  docsxai-viewer pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]
  docsxai-viewer drift <workspace-or-raw-dir> --against <pack-dir> [--from-raw] [--threshold <pct>]`;

export const PACK_DETAILS = `  pack — build the screenshot pack: burn annotations, optimise losslessly, hash-name, write manifest.json
    <dir>            a workspace (has docs/ and pack.json) or a raw capture directory
                     (<flow>/<step>/<locale>.<theme>.<viewport>.png + .json, step.json, flow.json)
    --from-raw       read <dir> as a raw capture even when it has a docs/ directory
    --out            output directory (default <workspace>/.screens; required for a raw capture)
    --public-prefix  URL path the files are served under (default ${DEFAULT_PUBLIC_PREFIX})
    --no-optimise    skip oxipng; without this flag oxipng must be installed
    --generated-for  free text recorded as generated_for (a commit sha, a build id); omitted when unset

  drift — rebuild in memory and compare with a committed pack
    --against        the committed pack directory (manifest.json and the PNGs)
    --threshold      percent of changed pixels a variant may differ by (default ${DEFAULT_THRESHOLD_PCT});
                     a resized, new or missing variant always fails
`;

interface Parsed {
  positional: string;
  values: Map<string, string>;
  flags: Set<string>;
}

/** argv → one positional, `--name value` pairs and `--flag`s. A string result is the usage error. */
function parseArgs(argv: string[], valued: string[], bare: string[]): Parsed | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (bare.includes(a)) flags.add(a);
    else if (valued.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      values.set(a, v);
    } else if (a.startsWith("--")) return `unknown flag ${a}`;
    else positionals.push(a);
  }
  if (positionals.length === 0) return "missing <workspace-or-raw-dir>";
  if (positionals.length > 1) return `unexpected argument "${positionals[1]}"`;
  return { positional: positionals[0]!, values, flags };
}

function usageError(command: string, message: string): number {
  process.stderr.write(`${command}: ${message}\n\nUsage:\n${PACK_SYNOPSIS}\n\n${PACK_DETAILS}\n`);
  return 2;
}

async function isDirectory(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

async function loadSource(
  dir: string,
  fromRaw: boolean,
): Promise<{ source: PackSource; workspace: boolean }> {
  if (!(await isDirectory(dir))) throw new Error(`${dir} is not a directory`);
  if (fromRaw || !(await isDirectory(path.join(dir, "docs")))) {
    return { source: await readRawCapture(dir), workspace: false };
  }
  const config = path.join(dir, PACK_CONFIG_FILE);
  if (
    !(await fs.stat(config).then(
      (s) => s.isFile(),
      () => false,
    ))
  ) {
    throw new Error(
      `${dir} has docs/ but no ${PACK_CONFIG_FILE}. Add one (docsxai/pack-config@1) naming which capture flow feeds which variant and the alt text, or pass --from-raw for a raw capture directory.`,
    );
  }
  return { source: await readWorkspace(dir), workspace: true };
}

const warn = (message: string): void => {
  process.stderr.write(`warning: ${message}\n`);
};

export async function runPack(argv: string[]): Promise<number> {
  const parsed = parseArgs(
    argv,
    ["--out", "--public-prefix", "--generated-for"],
    ["--from-raw", "--no-optimise"],
  );
  if (typeof parsed === "string") return usageError("pack", parsed);
  const dir = parsed.positional;
  const out = parsed.values.get("--out");
  try {
    const { source, workspace } = await loadSource(dir, parsed.flags.has("--from-raw"));
    if (out === undefined && !workspace) {
      return usageError("pack", "--out is required when <dir> is a raw capture directory");
    }
    const optimise = parsed.flags.has("--no-optimise")
      ? identityOptimiser
      : await createOxipngOptimiser(oxipngCommand());
    const outDir = path.resolve(out ?? path.join(dir, ".screens"));
    const prefix = parsed.values.get("--public-prefix");
    const generatedFor = parsed.values.get("--generated-for");
    const built = await buildPack({
      source,
      optimise,
      warn,
      ...(prefix !== undefined ? { publicPrefix: prefix } : {}),
      ...(generatedFor !== undefined ? { generatedFor } : {}),
    });
    const { written, removed } = await writePack({
      outDir,
      files: built.files,
      manifestText: built.manifestText,
    });
    process.stdout.write(
      `pack: ${built.files.size} image(s), ${written.length} written, ${removed.length} removed in ${outDir}\n`,
    );
    if (built.unplaceable > 0) {
      warn(
        `${built.unplaceable} callout(s) found no clear spot; \`docsxai burn --report\` lists them`,
      );
    }
    return 0;
  } catch (e) {
    process.stderr.write(`pack: ${(e as Error).message}\n`);
    return 1;
  }
}

export async function runDrift(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, ["--against", "--threshold"], ["--from-raw"]);
  if (typeof parsed === "string") return usageError("drift", parsed);
  const against = parsed.values.get("--against");
  if (against === undefined) return usageError("drift", "--against <pack-dir> is required");
  const raw = parsed.values.get("--threshold");
  const threshold = raw === undefined ? DEFAULT_THRESHOLD_PCT : Number(raw);
  if (!Number.isFinite(threshold) || threshold < 0) {
    return usageError("drift", "--threshold needs a percentage >= 0");
  }
  try {
    const { source } = await loadSource(parsed.positional, parsed.flags.has("--from-raw"));
    const fresh = await buildPack({ source, optimise: identityOptimiser, warn });
    const report = await computeDrift({
      fresh,
      against: path.resolve(against),
      thresholdPct: threshold,
    });
    process.stdout.write(`${report.text}\n`);
    return report.failing > 0 ? 1 : 0;
  } catch (e) {
    process.stderr.write(`drift: ${(e as Error).message}\n`);
    return 1;
  }
}
