// pull_pack — fetch a revision's artifacts from the backend back into the workspace files.

import {
  createBackendClient,
  fetchScreenshotBlobs,
  loadWorkspaceConfig,
  writeDocPack,
  type DocPackPayloads,
} from "@docsxai/engine";
import { z } from "zod";
import { backendFailure } from "../backend-failure.js";
import { defineTool, fail, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const pullPackTool = defineTool({
  name: "pull_pack",
  title: "Pull a doc-pack revision from the backend",
  description:
    "Download a doc-pack revision from the backend and write it into the workspace, to pick up " +
    "another operator's edits or to roll back to a named revision. Overwrites the local flow, " +
    "annotation, screenshot, style and locator files the revision contains, so push_pack first " +
    "if you have local edits you want to keep. Needs the workspace bound to a backend " +
    "(backend_url plus workspace and project ids in .docsxai.json; push_pack creates the ids) " +
    "and a valid backend token. Returns { revision, kind, author, filesWritten }.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    rev: z.string().min(1).optional().describe("Revision id to pull (default: the head revision)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const wsCfg = await loadWorkspaceConfig(ws);
    if (!wsCfg?.backend_url || !wsCfg.backend_workspace_id || !wsCfg.backend_project_id) {
      const missing = (
        ["backend_url", "backend_workspace_id", "backend_project_id"] as const
      ).filter((k) => !wsCfg?.[k]);
      return fail(
        `the workspace is not bound to a backend: .docsxai.json has no ${missing.join(", ")}`,
        "set backend_url in .docsxai.json and run push_pack, which creates the workspace and " +
          "project ids, or fill in backend_workspace_id and backend_project_id to pull from an " +
          "existing project",
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
      const failure = backendFailure(e, ctx);
      if (failure) return failure;
      throw e;
    }
  },
});
