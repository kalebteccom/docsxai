// Shared tool plumbing: the {ok, …} | {ok:false, error, hint} result convention, the
// default-workspace context, workspace validation, and flow-file loading helpers every
// tool reuses. Tools live one-per-file under src/tools/; only src/server.ts composes them.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  FlowFileError,
  parseFlowFile,
  resolveFlowExtends,
  resolveWorkspacePath,
  WORKSPACE_CONFIG_FILE,
  type FlowFile,
} from "@docsxai/engine";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Result convention
// ---------------------------------------------------------------------------

export type ToolOk = { ok: true } & Record<string, unknown>;
export type ToolFail = { ok: false; error: string; hint?: string };
export type ToolResult = ToolOk | ToolFail;

export function ok(fields: Record<string, unknown> = {}): ToolOk {
  return { ...fields, ok: true };
}

export function fail(error: string, hint?: string): ToolFail {
  return { ok: false, error, ...(hint ? { hint } : {}) };
}

// ---------------------------------------------------------------------------
// Tool definition shape
// ---------------------------------------------------------------------------

/** Server-wide context every handler receives (the `--workspace <dir>` default). */
export interface ToolContext {
  /** Default workspace dir from the bin's `--workspace` flag; used when a call omits `workspace`. */
  defaultWorkspace?: string;
}

/**
 * One tool = one file under src/tools/, exporting a `ToolDefinition`. `handler` is declared
 * with method syntax (bivariant) so each tool can type its args precisely via its own schema.
 */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Identity helper that pins the precise per-tool arg type onto the erased interface. */
export function defineTool<Shape extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler(args: z.output<z.ZodObject<Shape>>, ctx: ToolContext): Promise<ToolResult>;
}): ToolDefinition {
  return def;
}

// ---------------------------------------------------------------------------
// Workspace + flow-file helpers
// ---------------------------------------------------------------------------

/** Thrown by helpers; the server wrapper converts it to {ok:false, error, hint}. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

export const NO_WORKSPACE_HINT =
  "pass `workspace` in the tool arguments, or start docsxai-mcp with --workspace <dir>";

/**
 * Resolve the workspace dir (explicit arg wins over the server default) and verify it is a
 * docsxai workspace (a `.docsxai.json` marker exists). Returns the absolute path.
 */
export async function requireWorkspace(
  explicit: string | undefined,
  ctx: ToolContext,
): Promise<string> {
  const dir = explicit ?? ctx.defaultWorkspace;
  if (!dir) throw new ToolInputError("no workspace directory given", NO_WORKSPACE_HINT);
  const abs = path.resolve(dir);
  try {
    await fs.access(path.join(abs, WORKSPACE_CONFIG_FILE));
  } catch {
    throw new ToolInputError(
      `${abs} is not a docsxai workspace (no ${WORKSPACE_CONFIG_FILE} found)`,
      "create one with the init_workspace tool (or `docsxai init <dir>`)",
    );
  }
  return abs;
}

/** Absolute paths of every `flows/*.flow.yaml` in the workspace, sorted. */
export async function listFlowFiles(workspace: string): Promise<string[]> {
  const dir = resolveWorkspacePath(workspace, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new ToolInputError(
      `no flows directory at ${dir}`,
      "calibrate a flow first (flows/<name>.flow.yaml)",
    );
  }
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .sort()
    .map((e) => resolveWorkspacePath(workspace, "flows", e));
}

/** Parse every flow-file in the workspace into a name → FlowFile map (extends NOT resolved). */
export async function loadFlowsByName(workspace: string): Promise<Map<string, FlowFile>> {
  const flowsByName = new Map<string, FlowFile>();
  for (const p of await listFlowFiles(workspace)) {
    try {
      const flow = parseFlowFile(await fs.readFile(p, "utf8"), path.basename(p));
      flowsByName.set(flow.name, flow);
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      throw new ToolInputError(`parse error in ${p}: ${msg}`);
    }
  }
  return flowsByName;
}

/** Load one flow by name and resolve its `extends` chain into the merged flow. */
export async function loadMergedFlow(workspace: string, name: string): Promise<FlowFile> {
  const loadFlowFile = async (n: string): Promise<FlowFile> => {
    const fp = resolveWorkspacePath(workspace, "flows", `${n}.flow.yaml`);
    let text: string;
    try {
      text = await fs.readFile(fp, "utf8");
    } catch {
      throw new FlowFileError(`no flow named "${n}" at ${fp}`);
    }
    return parseFlowFile(text, fp);
  };
  const parsed = await loadFlowFile(name);
  return parsed.extends ? resolveFlowExtends(parsed, loadFlowFile) : parsed;
}

/** Standard error → ToolResult conversion for the server wrapper. */
export function toFailure(e: unknown): ToolFail {
  if (e instanceof ToolInputError) return fail(e.message, e.hint);
  return fail(e instanceof Error ? e.message : String(e));
}
