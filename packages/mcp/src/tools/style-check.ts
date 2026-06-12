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
import { defineTool, fail, ok, requireWorkspace } from "../shared.js";

export const styleCheckTool = defineTool({
  name: "style_check",
  title: "Validate style + scan for jargon leaks",
  description:
    "Initialise docs/style.yaml if absent (otherwise validate it), rederive docs/style.json, and " +
    "scan every docs/<flow>/<step>.md write-up for jargon leaks against the style's pruning rules.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    check: z
      .boolean()
      .optional()
      .describe("Scan write-ups for jargon leaks (default true; false = validate/derive only)"),
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
