// style — init/validate docs/style.yaml and rederive style.json; --check scans prose for jargon leaks.
// Split from cli-commands-authoring.ts to keep both files under the max-lines ceiling.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  formatJargonHitsText,
  initStyleIfAbsent,
  loadStyle,
  scanWorkspaceForJargon,
  StyleError,
  writeStyle,
} from "./style.js";
import { bareValueFlagExit } from "./cli-shared.js";
import { parseCommandFlags } from "./cli-flags.js";
import { shellQuote, usageError, withNext } from "./cli-messages.js";

export async function cmdStyle(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("style", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("style", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareStyle = bareValueFlagExit("style", flags, ["format"]);
  if (bareStyle !== undefined) return bareStyle;
  const check = flags.get("check") === true;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    return usageError("style", '--format must be "text" or "json"');
  }

  const isDir = await fs.stat(projectDir).then(
    (st) => st.isDirectory(),
    () => false,
  );
  if (!isDir) {
    const note = withNext(
      `${projectDir} is not a directory`,
      `docsxai init ${shellQuote(projectDir)}  (or fix the path)`,
    );
    process.stderr.write(`style: ${note}\n`);
    return 1;
  }

  // init-if-absent (idempotent); then load + validate; then rederive JSON; then optional jargon check.
  const { created } = await initStyleIfAbsent(projectDir);
  let style;
  try {
    style = await loadStyle(projectDir);
  } catch (e) {
    if (e instanceof StyleError) {
      process.stderr.write(
        `style: ${withNext(e.message, `fix docs/style.yaml, then docsxai style ${shellQuote(projectDir)}`)}\n`,
      );
      return 1;
    }
    throw e;
  }
  if (!style) {
    // Shouldn't happen after initStyleIfAbsent, but defensive.
    process.stderr.write(`style: failed to initialise style.yaml in ${projectDir}\n`);
    return 1;
  }
  // Always rewrite to ensure derived JSON stays in sync with YAML (idempotent).
  const paths = await writeStyle(projectDir, style);

  let hits: Awaited<ReturnType<typeof scanWorkspaceForJargon>> = [];
  if (check) {
    hits = await scanWorkspaceForJargon(projectDir, style);
  }

  if (format === "json") {
    process.stdout.write(
      JSON.stringify({ style, paths, created, jargonLeaks: check ? hits : undefined }, null, 2) +
        "\n",
    );
  } else {
    process.stdout.write(
      `style: ${created ? "created" : "validated"} ${path.relative(projectDir, paths.yamlPath)}; rederived ${path.relative(projectDir, paths.jsonPath)}\n`,
    );
    if (check) {
      process.stdout.write("\n");
      process.stdout.write(formatJargonHitsText(hits));
    }
  }

  return check && hits.length > 0 ? 1 : 0;
}
