// pull_pack — fetch a revision's artifacts from the backend back into the workspace files.

import {
  BackendClientError,
  createBackendClient,
  fetchScreenshotBlobs,
  loadWorkspaceConfig,
  writeDocPack,
  type DocPackPayloads,
} from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace } from "../shared.js";

export const pullPackTool = defineTool({
  name: "pull_pack",
  title: "Pull a doc-pack revision from the backend",
  description:
    "Fetch a revision's artifacts (default: HEAD) from the bound backend back into the workspace " +
    "files — for syncing another operator's edits or rolling back to a named revision.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    rev: z.string().optional().describe("Revision id (default: head)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const wsCfg = await loadWorkspaceConfig(ws);
    if (!wsCfg?.backend_url || !wsCfg.backend_workspace_id || !wsCfg.backend_project_id) {
      return fail(
        "workspace isn't bound to a backend yet",
        "push_pack first (or hand-edit .site-docs.json's backend_workspace_id / backend_project_id)",
      );
    }
    try {
      const client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: ws });
      const rev = await client.getRevision(
        wsCfg.backend_workspace_id,
        wsCfg.backend_project_id,
        args.rev ?? "head",
      );
      const payloads: Partial<DocPackPayloads> = {};
      for (const artifact of rev.artifacts) {
        (payloads as Record<string, unknown>)[artifact] = await client.getArtifact(
          wsCfg.backend_workspace_id,
          wsCfg.backend_project_id,
          rev.id,
          artifact,
        );
      }
      const screenshotBytes = payloads.screenshots
        ? await fetchScreenshotBlobs(payloads.screenshots, client)
        : undefined;
      const r = await writeDocPack(ws, payloads, screenshotBytes ? { screenshotBytes } : {});
      return ok({
        workspace: ws,
        revision: rev.id,
        kind: rev.kind,
        author: rev.author,
        filesWritten: r.filesWritten,
      });
    } catch (e) {
      if (e instanceof BackendClientError) {
        return fail(e.message, "is the backend reachable and the token valid (SITE_DOCS_TOKEN)?");
      }
      throw e;
    }
  },
});
