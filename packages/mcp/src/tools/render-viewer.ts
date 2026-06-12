// render_viewer — build the static viewer by resolving + spawning the docsxai-viewer bin
// (the engine's resolution order: SITE_DOCS_VIEWER_BIN, the installed package, PATH).

import { spawn } from "node:child_process";
import * as path from "node:path";
import {
  formatViewerBinFailure,
  resolveViewerBin,
  resolveWorkspacePath,
} from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace, type ToolResult } from "../shared.js";

export const renderViewerTool = defineTool({
  name: "render_viewer",
  title: "Render the static viewer",
  description:
    "Build the workspace's static HTML viewer from docs/ into .viewer/ by spawning the " +
    "docsxai-viewer bin (resolved via SITE_DOCS_VIEWER_BIN, the installed " +
    "@kalebtec/docsxai-viewer package, then PATH).",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const docsDir = resolveWorkspacePath(ws, "docs");
    const outDir = resolveWorkspacePath(ws, ".viewer");
    const viewerBin = await resolveViewerBin();

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(viewerBin.command, [...viewerBin.prefixArgs, "build", docsDir, outDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (e: NodeJS.ErrnoException) => {
        resolve(
          e.code === "ENOENT"
            ? fail(formatViewerBinFailure(viewerBin))
            : fail(`viewer failed to launch: ${e.message}`),
        );
      });
      child.on("exit", (code) => {
        if ((code ?? 1) === 0) {
          resolve(
            ok({
              workspace: ws,
              outDir,
              indexHtml: path.join(outDir, "index.html"),
              viewerSource: viewerBin.source,
              output: stdout.trim(),
            }),
          );
        } else {
          resolve(
            fail(
              `viewer exited with code ${code}: ${(stderr || stdout).trim().slice(-2000)}`,
              "is there a rendered docs/ tree to build from? Run run_flows first.",
            ),
          );
        }
      });
    });
  },
});
