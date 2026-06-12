// zip_pack — package the workspace's doc pack into a deterministic hand-off archive.

import * as path from "node:path";
import { zipDocPack, ZipError } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace } from "../shared.js";

export const zipPackTool = defineTool({
  name: "zip_pack",
  title: "Zip the doc pack",
  description:
    "Package the workspace's doc pack (flows/, docs/, .docsxai.json, auth/strategy.yaml, " +
    "README.md) into a deterministic zip. Excludes .auth/, halts/, and .viewer/ by default.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    out: z
      .string()
      .optional()
      .describe("Output zip path (default: <workspace>.zip next to the workspace dir)"),
    includeViewer: z.boolean().optional().describe("Bundle the rendered .viewer/ output too"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const output = args.out ? path.resolve(args.out) : `${path.resolve(ws)}.zip`;
    try {
      const r = await zipDocPack({
        workspace: ws,
        output,
        includeViewer: args.includeViewer ?? false,
      });
      return ok({ workspace: ws, output: r.output, entries: r.entries, bytes: r.bytes });
    } catch (e) {
      if (e instanceof ZipError) return fail(e.message);
      throw e;
    }
  },
});
