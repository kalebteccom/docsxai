// zip_pack — package the workspace's doc pack into a deterministic hand-off archive.

import * as path from "node:path";
import { zipDocPack, ZipError } from "@docsxai/engine";
import { z } from "zod";
import {
  defineTool,
  fail,
  ok,
  requireWorkspace,
  resolveToolPath,
  type ToolContext,
  WORKSPACE_ARG,
} from "../shared.js";

/**
 * Where the archive goes. The default is `<workspace>.zip` next to the workspace; when that sits
 * outside the HTTP workspace root (the root itself is the workspace) it goes inside the workspace.
 */
async function resolveOutput(
  out: string | undefined,
  ws: string,
  ctx: ToolContext,
): Promise<string> {
  if (out) return resolveToolPath(out, ctx);
  const sibling = `${path.resolve(ws)}.zip`;
  if (!ctx.workspaceRoot) return sibling;
  return resolveToolPath(sibling, ctx).catch(() => path.join(ws, `${path.basename(ws)}.zip`));
}

export const zipPackTool = defineTool({
  name: "zip_pack",
  title: "Zip the doc pack",
  description:
    "Package the workspace's doc pack into a deterministic zip for hand-off: flows/, docs/, " +
    ".docsxai.json, auth/strategy.yaml and README.md. Cached sessions (.auth/), halt " +
    "screenshots and the built viewer are left out unless `includeViewer` adds the viewer. " +
    "Returns { output, entries, bytes }. Fails with a hint when the archive cannot be built.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    out: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Where to write the zip (default: <workspace>.zip next to the workspace directory; inside the workspace when that would fall outside the HTTP workspace root)",
      ),
    includeViewer: z
      .boolean()
      .optional()
      .describe("Also bundle the rendered .viewer/ output (default false)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const output = await resolveOutput(args.out, ws, ctx);
    try {
      const r = await zipDocPack({
        workspace: ws,
        output,
        includeViewer: args.includeViewer ?? false,
      });
      return ok({ workspace: ws, output: r.output, entries: r.entries, bytes: r.bytes });
    } catch (e) {
      if (e instanceof ZipError) {
        return fail(
          e.message,
          "the workspace needs flows/ or docs/ (run_flows creates docs/ output); check `workspace`, then retry",
        );
      }
      throw e;
    }
  },
});
