// get_run_artifacts — read-only: the artifact PATHS a run produced (no file contents).
// Screenshots/halt shots can be large; the host agent reads the ones it needs.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { resolveWorkspacePath } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, ok, requireWorkspace } from "../shared.js";

async function listPngs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir))
      .filter((e) => e.endsWith(".png"))
      .sort()
      .map((e) => path.join(dir, e));
  } catch {
    return [];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export const getRunArtifactsTool = defineTool({
  name: "get_run_artifacts",
  title: "List run artifact paths",
  description:
    "List the absolute paths of a run's artifacts per flow — annotations.json, screenshots, halt " +
    "screenshots, step write-ups — plus workspace-level style/locators. Paths only, no contents.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    flow: z.string().optional().describe("Limit to one flow (default: every flow under docs/)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const docsDir = resolveWorkspacePath(ws, "docs");
    let flowDirs: string[] = [];
    try {
      const entries = await fs.readdir(docsDir, { withFileTypes: true });
      flowDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((n) => !args.flow || n === args.flow)
        .sort();
    } catch {
      flowDirs = [];
    }

    const flows = [];
    for (const name of flowDirs) {
      const flowDir = resolveWorkspacePath(ws, "docs", name);
      const annotations = resolveWorkspacePath(ws, "docs", name, "annotations.json");
      const writeUps = (await fs.readdir(flowDir).catch(() => [] as string[]))
        .filter((e) => e.endsWith(".md"))
        .sort()
        .map((e) => resolveWorkspacePath(ws, "docs", name, e));
      flows.push({
        flow: name,
        ...((await exists(annotations)) ? { annotations } : {}),
        screenshots: await listPngs(resolveWorkspacePath(ws, "docs", name, "screenshots")),
        halts: await listPngs(resolveWorkspacePath(ws, "docs", name, "halts")),
        writeUps,
      });
    }

    const styleYaml = resolveWorkspacePath(ws, "docs", "style.yaml");
    const locatorsYaml = resolveWorkspacePath(ws, "docs", "locators.yaml");
    const viewerIndex = resolveWorkspacePath(ws, ".viewer", "index.html");
    return ok({
      workspace: ws,
      flows,
      ...((await exists(styleYaml)) ? { style: styleYaml } : {}),
      ...((await exists(locatorsYaml)) ? { locators: locatorsYaml } : {}),
      ...((await exists(viewerIndex)) ? { viewerIndex } : {}),
    });
  },
});
