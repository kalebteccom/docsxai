// push_pack — serialise the workspace's doc pack and POST it as a new revision against the
// backend named in .docsxai.json (binding created + persisted on first push).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  createBackendClient,
  readDocPack,
  resolveWorkspacePath,
  uploadScreenshotBlobs,
  type DocPackPayloads,
} from "@docsxai/engine";
import { z } from "zod";
import { backendFailure } from "../backend-failure.js";
import { defineTool, fail, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const pushPackTool = defineTool({
  name: "push_pack",
  title: "Push the doc pack to the backend",
  description:
    "Upload the workspace's doc pack (flows, annotations, screenshots, style, locators) to the " +
    "backend as a new revision, to share it or keep history. Needs backend_url in " +
    ".docsxai.json and a valid backend token. The first push also creates the backend " +
    "workspace and project and writes their ids into .docsxai.json. Unchanged screenshots are " +
    "not re-uploaded. Returns { revision, kind, author, artifactsPushed, screenshots }. " +
    "Fails with a hint when backend_url is missing or the backend rejects the request.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    kind: z
      .enum(["calibrate", "run", "edit"])
      .optional()
      .describe("Revision kind: calibrate (default), run or edit"),
    author: z
      .string()
      .min(1)
      .optional()
      .describe("Revision author name (default: the server process's OS user)"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const cfgPath = resolveWorkspacePath(ws, ".docsxai.json");
    let wsCfg: {
      backend_url?: string;
      backend_workspace_id?: string;
      backend_project_id?: string;
      [k: string]: unknown;
    };
    try {
      wsCfg = JSON.parse(await fs.readFile(cfgPath, "utf8")) as typeof wsCfg;
    } catch {
      // The parser's message quotes a piece of the file; the file name is what the caller needs.
      return fail(".docsxai.json is not valid JSON", "fix .docsxai.json so it parses, then retry");
    }
    if (!wsCfg.backend_url) {
      return fail(
        "no backend_url in .docsxai.json",
        "set backend_url in .docsxai.json to the backend's address, then push again",
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
      const failure = backendFailure(e, ctx);
      if (failure) return failure;
      throw e;
    }
  },
});
