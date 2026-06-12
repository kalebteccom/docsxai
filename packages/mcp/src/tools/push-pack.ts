// push_pack — serialise the workspace's doc pack and POST it as a new revision against the
// backend named in .site-docs.json (binding created + persisted on first push).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  BackendClientError,
  createBackendClient,
  readDocPack,
  resolveWorkspacePath,
  uploadScreenshotBlobs,
  type DocPackPayloads,
} from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace } from "../shared.js";

export const pushPackTool = defineTool({
  name: "push_pack",
  title: "Push the doc pack to the backend",
  description:
    "Serialise the workspace's doc pack (flows + annotations + screenshots + style + locators) " +
    "and push it as a new revision to the backend named in .site-docs.json. Screenshot bytes go " +
    "up as content-addressed blobs; unchanged PNGs are skipped.",
  inputSchema: {
    workspace: z.string().optional().describe("Workspace dir (defaults to the server's --workspace)"),
    kind: z.enum(["calibrate", "run", "edit"]).optional().describe("Revision kind (default calibrate)"),
    author: z.string().optional().describe("Revision author (default: the OS user)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const cfgPath = resolveWorkspacePath(ws, ".site-docs.json");
    const wsCfg = JSON.parse(await fs.readFile(cfgPath, "utf8")) as {
      backend_url?: string;
      backend_workspace_id?: string;
      backend_project_id?: string;
      [k: string]: unknown;
    };
    if (!wsCfg.backend_url) {
      return fail(
        `no backend_url in ${cfgPath}`,
        "set backend_url in .site-docs.json before pushing",
      );
    }
    const kind = args.kind ?? "calibrate";
    const author = args.author ?? process.env.USER ?? "unknown";

    try {
      const client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: ws });
      let wsId = wsCfg.backend_workspace_id;
      let projectId = wsCfg.backend_project_id;
      let createdBinding = false;
      const name = path.basename(path.resolve(ws));
      if (!wsId) {
        wsId = (await client.createWorkspace(name)).id;
        createdBinding = true;
      }
      if (!projectId) {
        projectId = (await client.createProject(wsId, name)).id;
        createdBinding = true;
      }
      if (createdBinding) {
        await fs.writeFile(
          cfgPath,
          JSON.stringify(
            { ...wsCfg, backend_workspace_id: wsId, backend_project_id: projectId },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      }

      const rev = await client.createRevision(wsId, projectId, { kind, author });
      const payloads = await readDocPack(ws);
      let screenshots: { uploaded: number; skipped: number } | undefined;
      if (payloads.screenshots) {
        screenshots = await uploadScreenshotBlobs(ws, payloads.screenshots, client);
      }
      let pushed = 0;
      for (const [key, p] of Object.entries(payloads) as Array<
        [keyof DocPackPayloads, DocPackPayloads[keyof DocPackPayloads]]
      >) {
        if (p === null) continue;
        await client.putArtifact(wsId, projectId, rev.id, key, p);
        pushed++;
      }
      await client.finalizeRevision(wsId, projectId, rev.id);
      return ok({
        workspace: ws,
        revision: rev.id,
        kind,
        author,
        artifactsPushed: pushed,
        ...(screenshots ? { screenshots } : {}),
        ...(createdBinding ? { createdBinding: true } : {}),
      });
    } catch (e) {
      if (e instanceof BackendClientError) {
        return fail(e.message, "is the backend reachable and the token valid (SITE_DOCS_TOKEN)?");
      }
      throw e;
    }
  },
});
