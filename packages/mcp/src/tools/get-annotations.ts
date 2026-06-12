// get_annotations — read-only: a flow's emitted annotations.json (validated against the schema).

import { promises as fs } from "node:fs";
import { AnnotationsFile, resolveWorkspacePath } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace } from "../shared.js";

export const getAnnotationsTool = defineTool({
  name: "get_annotations",
  title: "Read a flow's annotations",
  description:
    "Read docs/<flow>/annotations.json — the annotation records (step, selector, copy, arrow " +
    "style, bounding box) the last run emitted for the flow.",
  inputSchema: {
    workspace: z
      .string()
      .optional()
      .describe("Workspace dir (defaults to the server's --workspace)"),
    flow: z.string().min(1).describe("Flow name"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const p = resolveWorkspacePath(ws, "docs", args.flow, "annotations.json");
    let text: string;
    try {
      text = await fs.readFile(p, "utf8");
    } catch {
      return fail(
        `no annotations for flow "${args.flow}" at ${p}`,
        "run the flow first (run_flows) — annotations.json is emitted by execution",
      );
    }
    const parsed = AnnotationsFile.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return fail(
        `${p} does not match the annotations schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return ok({ workspace: ws, flow: args.flow, path: p, annotations: parsed.data });
  },
});
