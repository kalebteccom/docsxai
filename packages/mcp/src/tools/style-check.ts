// style_check — init-if-absent + validate docs/style.yaml, rederive the JSON, and (optionally)
// scan the user-facing write-ups for jargon leaks. The enforcement layer for semantic reshape.

import * as path from "node:path";
import {
  initStyleIfAbsent,
  loadStyle,
  scanWorkspaceForJargon,
  StyleError,
  writeStyle,
} from "@docsxai/engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const styleCheckTool = defineTool({
  name: "style_check",
  title: "Validate style + scan for jargon leaks",
  description:
    "Validate the workspace's writing style and scan the step write-ups for jargon leaks. " +
    "Creates docs/style.yaml when it is absent, rewrites docs/style.json from it, and (unless " +
    "`check` is false) scans every docs/<flow>/<step>.md against the style's pruning rules. " +
    "Returns { styleYaml, styleJson, jargonLeaks, clean }; each leak has the file, line, " +
    "category and matching snippet. It never rewrites prose: reshape the flagged text yourself, then call again. " +
    "Fails with the schema error when docs/style.yaml is invalid.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    check: z
      .boolean()
      .optional()
      .describe(
        "Scan write-ups for jargon leaks (default true). Pass false to only validate and rederive the style. The `docsxai style` CLI defaults the other way.",
      ),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const check = args.check ?? true;
    const { created } = await initStyleIfAbsent(ws);
    let style;
    try {
      style = await loadStyle(ws);
    } catch (e) {
      if (e instanceof StyleError) return fail(e.message, "fix docs/style.yaml against the schema");
      throw e;
    }
    if (!style) return fail(`failed to initialise style.yaml in ${ws}`);
    const paths = await writeStyle(ws, style);
    const jargonLeaks = check ? await scanWorkspaceForJargon(ws, style) : [];
    return ok({
      workspace: ws,
      created,
      styleYaml: paths.yamlPath,
      styleJson: paths.jsonPath,
      checked: check,
      jargonLeaks,
      clean: jargonLeaks.length === 0,
      ...(jargonLeaks.length
        ? {
            hintForFixes: `reshape the flagged prose in ${path.join("docs", "<flow>", "<step>.md")} — the engine never rewrites prose itself`,
          }
        : {}),
    });
  },
});
