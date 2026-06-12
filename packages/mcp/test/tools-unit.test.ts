// Per-tool unit tests: zod arg-schema validation + handler error paths (no browser, no backend).
// The scripted-client suite covers the happy paths over the wire; this file pins the failure
// shapes — every error is {ok:false, error, hint?}, never a throw.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBinArgs, TOOL_DEFINITIONS } from "../src/index.js";
import type { ToolDefinition, ToolResult } from "../src/shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFlow = path.resolve(here, "../../engine/test/fixtures/recap-open.flow.yaml");

const byName = new Map<string, ToolDefinition>(TOOL_DEFINITIONS.map((d) => [d.name, d]));
function tool(name: string): ToolDefinition {
  const def = byName.get(name);
  if (!def) throw new Error(`no tool ${name}`);
  return def;
}
function schema(name: string): z.ZodObject<z.ZodRawShape> {
  return z.object(tool(name).inputSchema);
}
async function run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return tool(name).handler(args, {});
}

let tmp: string;
let ws: string; // a valid workspace with the fixture flow, no auth
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-unit-"));
  ws = path.join(tmp, "ws");
  const { initWorkspace } = await import("@docsxai/engine");
  await initWorkspace({ dir: ws, auth: "none" });
  await fs.copyFile(fixtureFlow, path.join(ws, "flows", "recap-open.flow.yaml"));
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("registry shape", () => {
  it("exposes exactly the 14 boundary tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(14);
    expect(new Set(TOOL_DEFINITIONS.map((d) => d.name)).size).toBe(14);
  });

  it("every tool has a title, description, and schema", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(Object.keys(def.inputSchema).length).toBeGreaterThan(0);
    }
  });

  it("every tool except init_workspace takes an optional workspace arg", () => {
    for (const def of TOOL_DEFINITIONS) {
      if (def.name === "init_workspace") continue;
      expect(Object.keys(def.inputSchema)).toContain("workspace");
    }
  });
});

describe("no-workspace error path is uniform", () => {
  const needsWorkspace = TOOL_DEFINITIONS.filter((d) => d.name !== "init_workspace");
  for (const def of needsWorkspace) {
    it(`${def.name} without a workspace fails with the --workspace hint`, async () => {
      const args: Record<string, unknown> =
        def.name === "diagnose_halt"
          ? { flow: "x", step: "y" }
          : def.name === "get_annotations"
            ? { flow: "x" }
            : {};
      const r = await def.handler(args, {}).catch((e: unknown) => {
        // requireWorkspace throws ToolInputError; the server wrapper converts it. Mirror that here.
        return {
          ok: false as const,
          error: (e as Error).message,
          hint: (e as { hint?: string }).hint,
        };
      });
      expect(r.ok).toBe(false);
      expect(String((r as { hint?: string }).hint)).toContain("--workspace");
    });
  }

  it("a non-workspace dir fails with an init_workspace hint", async () => {
    const r = await run("list_flows", { workspace: tmp }).catch((e: unknown) => ({
      ok: false as const,
      error: (e as Error).message,
      hint: (e as { hint?: string }).hint,
    }));
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("init_workspace");
  });
});

describe("init_workspace", () => {
  it("requires dir", () => {
    expect(schema("init_workspace").safeParse({}).success).toBe(false);
    expect(schema("init_workspace").safeParse({ dir: "" }).success).toBe(false);
  });

  it("rejects an invalid auth value", () => {
    expect(schema("init_workspace").safeParse({ dir: "x", auth: "oauth" }).success).toBe(false);
  });

  it("fails (not throws) when the target dir is non-empty without force", async () => {
    const r = await run("init_workspace", { dir: ws });
    expect(r.ok).toBe(false);
    expect((r as { hint?: string }).hint).toContain("force");
  });
});

describe("run_flows", () => {
  it("rejects out-of-range concurrency", () => {
    expect(schema("run_flows").safeParse({ concurrency: 0 }).success).toBe(false);
    expect(schema("run_flows").safeParse({ concurrency: 17 }).success).toBe(false);
    expect(schema("run_flows").safeParse({ concurrency: 1.5 }).success).toBe(false);
    expect(schema("run_flows").safeParse({ concurrency: 4 }).success).toBe(true);
  });

  it("startFrom without flow fails with a hint", async () => {
    const r = await run("run_flows", { workspace: ws, startFrom: "open-sidebar" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("startFrom requires flow");
  });

  it("an unknown flow name fails with a list_flows hint", async () => {
    const r = await run("run_flows", { workspace: ws, flow: "nope" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('no flow named "nope"');
    expect((r as { hint?: string }).hint).toContain("list_flows");
  });

  it("a workspace with no flows dir fails cleanly", async () => {
    const bare = path.join(tmp, "bare-ws");
    await fs.mkdir(bare, { recursive: true });
    await fs.writeFile(path.join(bare, ".docsxai.json"), "{}\n");
    const r = await run("run_flows", { workspace: bare }).catch((e: unknown) => ({
      ok: false as const,
      error: (e as Error).message,
    }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("no flows directory");
  });
});

describe("lint_flows", () => {
  it("unknown flow filter fails with the available names", async () => {
    const r = await run("lint_flows", { workspace: ws, flow: "ghost" });
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("recap-open");
  });

  it("reports zero plugin rules for an unconfigured workspace", async () => {
    const r = await run("lint_flows", { workspace: ws });
    expect(r.ok).toBe(true);
    expect((r as { pluginRuleCount?: number }).pluginRuleCount).toBe(0);
  });
});

describe("flow_tree", () => {
  it("rejects a non-string workspace", () => {
    expect(schema("flow_tree").safeParse({ workspace: 42 }).success).toBe(false);
  });

  it("returns the fixture flow as a root", async () => {
    const r = await run("flow_tree", { workspace: ws });
    expect(r.ok).toBe(true);
    expect((r as { roots: Array<{ name: string }> }).roots[0]!.name).toBe("recap-open");
  });
});

describe("diagnose_halt", () => {
  it("requires flow and step", () => {
    expect(schema("diagnose_halt").safeParse({}).success).toBe(false);
    expect(schema("diagnose_halt").safeParse({ flow: "f" }).success).toBe(false);
    expect(schema("diagnose_halt").safeParse({ flow: "f", step: "s" }).success).toBe(true);
  });

  it("unknown flow fails cleanly", async () => {
    const r = await run("diagnose_halt", { workspace: ws, flow: "ghost", step: "s" }).catch(
      (e: unknown) => ({ ok: false as const, error: (e as Error).message }),
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("ghost");
  });

  it("unknown step fails with the merged step list as the hint", async () => {
    const r = await run("diagnose_halt", { workspace: ws, flow: "recap-open", step: "ghost" });
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("open-app");
  });
});

describe("style_check", () => {
  it("accepts check=false (validate/derive only)", async () => {
    const r = await run("style_check", { workspace: ws, check: false });
    expect(r.ok).toBe(true);
    expect((r as { checked?: boolean }).checked).toBe(false);
    expect((r as { jargonLeaks?: unknown[] }).jargonLeaks).toEqual([]);
  });

  it("flags a jargon leak in a step write-up", async () => {
    await fs.mkdir(path.join(ws, "docs", "recap-open"), { recursive: true });
    const writeUp = path.join(ws, "docs", "recap-open", "open-sidebar.md");
    await fs.writeFile(writeUp, 'Click the [data-testid="play"] button to VERIFY the recap.\n');
    try {
      const r = await run("style_check", { workspace: ws });
      expect(r.ok).toBe(true);
      expect((r as { clean?: boolean }).clean).toBe(false);
      expect(((r as { jargonLeaks?: unknown[] }).jargonLeaks ?? []).length).toBeGreaterThan(0);
    } finally {
      await fs.rm(writeUp, { force: true });
    }
  });
});

describe("zip_pack", () => {
  it("rejects a non-boolean includeViewer", () => {
    expect(schema("zip_pack").safeParse({ includeViewer: "yes" }).success).toBe(false);
  });

  it("honours an explicit out path", async () => {
    const out = path.join(tmp, "explicit.zip");
    const r = await run("zip_pack", { workspace: ws, out });
    expect(r.ok).toBe(true);
    expect((r as { output: string }).output).toBe(out);
    await fs.access(out);
  });
});

describe("push_pack / pull_pack", () => {
  it("push_pack without backend_url fails with a config hint", async () => {
    const r = await run("push_pack", { workspace: ws });
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("backend_url");
  });

  it("push_pack rejects an invalid kind", () => {
    expect(schema("push_pack").safeParse({ kind: "deploy" }).success).toBe(false);
    expect(schema("push_pack").safeParse({ kind: "run" }).success).toBe(true);
  });

  it("pull_pack on an unbound workspace fails with a push_pack hint", async () => {
    const r = await run("pull_pack", { workspace: ws });
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("push_pack");
  });
});

describe("get_annotations", () => {
  it("requires flow", () => {
    expect(schema("get_annotations").safeParse({}).success).toBe(false);
    expect(schema("get_annotations").safeParse({ flow: "" }).success).toBe(false);
  });

  it("missing annotations file fails with a run_flows hint", async () => {
    const r = await run("get_annotations", { workspace: ws, flow: "recap-open" });
    expect(r.ok).toBe(false);
    expect(String((r as { hint?: string }).hint)).toContain("run_flows");
  });
});

describe("get_run_artifacts", () => {
  it("an empty docs tree yields an empty flows list", async () => {
    const r = await run("get_run_artifacts", { workspace: ws, flow: "ghost" });
    expect(r.ok).toBe(true);
    expect((r as { flows: unknown[] }).flows).toEqual([]);
  });
});

describe("plugins_list", () => {
  it("unconfigured workspace reports zero plugins", async () => {
    const r = await run("plugins_list", { workspace: ws });
    expect(r.ok).toBe(true);
    expect((r as { configured: number }).configured).toBe(0);
  });
});

describe("render_viewer", () => {
  it("rejects a numeric workspace arg", () => {
    expect(schema("render_viewer").safeParse({ workspace: 1 }).success).toBe(false);
  });
});

describe("bin arg parsing", () => {
  it("parses --workspace <dir>", () => {
    expect(parseBinArgs(["--workspace", "/tmp/ws"])).toEqual({
      workspace: "/tmp/ws",
      help: false,
    });
  });

  it("rejects --workspace without a value", () => {
    expect(() => parseBinArgs(["--workspace"])).toThrow("--workspace requires");
    expect(() => parseBinArgs(["--workspace", "--help"])).toThrow("--workspace requires");
  });

  it("rejects unknown arguments and accepts --help", () => {
    expect(() => parseBinArgs(["--port", "1234"])).toThrow("unknown argument");
    expect(parseBinArgs(["--help"]).help).toBe(true);
  });
});
