// get_annotations — read-only: a flow's emitted annotations.json (validated against the schema).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AnnotationsFile, resolveWorkspacePath } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, fail, ok, requireWorkspace, WORKSPACE_ARG } from "../shared.js";

export const getAnnotationsTool = defineTool({
  name: "get_annotations",
  title: "Read a flow's annotations",
  description:
    "Read the annotations the last run_flows emitted for one flow (docs/<flow>/annotations.json): " +
    "per step the selector, copy, arrow style and bounding box. Use it to check what a run " +
    "produced before render_viewer or push_pack. Returns { path, annotations }, validated " +
    "against the annotations schema. Fails with a run_flows hint when the flow has no " +
    "annotations yet, or when annotations.json does not parse.",
  inputSchema: {
    workspace: WORKSPACE_ARG,
    flow: z.string().min(1).describe("Flow name, as list_flows reports it"),
  },
  async handler(args, ctx) {
    const ws = await requireWorkspace(args.workspace, ctx);
    const p = resolveWorkspacePath(ws, "docs", args.flow, "annotations.json");
    const rel = path.posix.join("docs", args.flow, "annotations.json");
    let text: string;
    try {
      text = await fs.readFile(p, "utf8");
    } catch {
      return fail(
        `no annotations for flow "${args.flow}" (${rel})`,
        "run the flow first (run_flows) — annotations.json is emitted by execution",
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // The parser's message quotes a piece of the file, so it is left out.
      return fail(
        `${rel} is not valid JSON`,
        "run_flows again for this flow to regenerate annotations.json",
      );
    }
    const parsed = AnnotationsFile.safeParse(raw);
    if (!parsed.success) {
      return fail(
        `${rel} does not match the annotations schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        "run_flows again for this flow to regenerate annotations.json",
      );
    }
    return ok({ workspace: ws, flow: args.flow, path: p, annotations: parsed.data });
  },
});
