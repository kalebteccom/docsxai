// Per-tool unit tests: zod arg-schema validation + handler error paths (no browser, no backend).
// The scripted-client suite covers the happy paths over the wire; this file pins the failure
// shapes — every error is {ok:false, error, hint?}, never a throw.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlowFileError } from "@docsxai/engine";
import { parseBinArgs, TOOL_DEFINITIONS } from "../src/index.js";
import { toFailure, type ToolDefinition, type ToolResult } from "../src/shared.js";

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

  it("every tool description says what it returns or reports", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.description.length, def.name).toBeGreaterThan(150);
      expect(def.description, def.name).toMatch(/\b(returns|fails)\b/i);
    }
  });

  it("every input argument has a description an agent can read", () => {
    for (const def of TOOL_DEFINITIONS) {
      for (const [key, field] of Object.entries(def.inputSchema)) {
        expect(field.description ?? "", `${def.name}.${key}`).not.toBe("");
      }
    }
  });

  it("every tool except init_workspace takes an optional workspace arg", () => {
    for (const def of TOOL_DEFINITIONS) {
      if (def.name === "init_workspace") continue;
      expect(Object.keys(def.inputSchema)).toContain("workspace");
    }
  });
});

describe("empty strings are refused instead of meaning something else", () => {
  it("an empty workspace is rejected by every tool that takes one", () => {
    for (const def of TOOL_DEFINITIONS) {
      if (def.name === "init_workspace") continue;
      expect(schema(def.name).safeParse({ workspace: "" }).success, def.name).toBe(false);
    }
  });

  it("an empty flow, step id, revision, output path or cdp endpoint is rejected", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["run_flows", { flow: "" }],
      ["run_flows", { startFrom: "" }],
      ["run_flows", { stopAfter: "" }],
      ["run_flows", { cdp: "" }],
      ["run_flows", { baseUrl: "" }],
      ["lint_flows", { flow: "" }],
      ["get_run_artifacts", { flow: "" }],
      ["diagnose_halt", { flow: "f", step: "s", cdp: "" }],
      ["pull_pack", { rev: "" }],
      ["push_pack", { author: "" }],
      ["zip_pack", { out: "" }],
    ];
    for (const [name, args] of cases) {
      expect(schema(name).safeParse(args).success, `${name} ${JSON.stringify(args)}`).toBe(false);
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

describe("failures name the failed thing and the next step", () => {
  let matrixWs: string; // auth none, one flow with a matrix
  let authWs: string; // manual-capture auth, no cached session
  let badCfgWs: string; // .docsxai.json is not JSON
  beforeAll(async () => {
    const { initWorkspace } = await import("@docsxai/engine");
    matrixWs = path.join(tmp, "matrix-ws");
    await initWorkspace({ dir: matrixWs, auth: "none" });
    await fs.writeFile(
      path.join(matrixWs, "flows", "themed.flow.yaml"),
      [
        "name: themed",
        "matrix:",
        "  color_schemes: [light, dark]",
        "steps:",
        "  - id: open",
        "    action: navigate",
        "    value: index.html",
        "    wait_for: load",
        "",
      ].join("\n"),
    );
    authWs = path.join(tmp, "auth-ws");
    await initWorkspace({ dir: authWs });
    await fs.copyFile(fixtureFlow, path.join(authWs, "flows", "recap-open.flow.yaml"));
    badCfgWs = path.join(tmp, "bad-config-ws");
    await fs.mkdir(badCfgWs, { recursive: true });
    await fs.writeFile(path.join(badCfgWs, ".docsxai.json"), "{not json secret-token-value");
  });

  const hintOf = (r: ToolResult): string => String((r as { hint?: string }).hint);
  const errorOf = (r: ToolResult): string => String((r as { error?: string }).error);

  it("run_flows without a cached session says a person has to capture one", async () => {
    const r = await run("run_flows", { workspace: authWs });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toContain('role "editor"');
    expect(hintOf(r)).toContain("capture-auth");
    expect(hintOf(r)).toContain("person");
  });

  it("run_flows lists the step ids when startFrom or stopAfter names a missing step", async () => {
    for (const args of [{ startFrom: "ghost" }, { stopAfter: "ghost" }]) {
      const r = await run("run_flows", { workspace: ws, flow: "recap-open", ...args });
      expect(r.ok).toBe(false);
      expect(errorOf(r)).toContain('no step "ghost"');
      expect(hintOf(r)).toContain("open-sidebar");
    }
  });

  it("run_flows reports a matrix flow as a failed flow with the CLI command", async () => {
    const r = await run("run_flows", { workspace: matrixWs });
    expect(r.ok).toBe(true);
    const res = r as unknown as {
      allOk: boolean;
      hint: string;
      flows: Array<{ flow: string; ok: boolean; error: string; hint: string }>;
    };
    expect(res.allOk).toBe(false);
    expect(res.hint).toContain("flows[].hint");
    expect(res.flows[0]).toMatchObject({ flow: "themed", ok: false });
    expect(res.flows[0]!.error).toContain("matrix");
    expect(res.flows[0]!.hint).toContain("--variant");
  });

  it("diagnose_halt refuses a matrix flow and names the CLI command", async () => {
    const r = await run("diagnose_halt", { workspace: matrixWs, flow: "themed", step: "open" });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toContain("matrix");
    expect(hintOf(r)).toContain("--variant");
  });

  it("get_annotations names the file and the fix when annotations.json is not JSON", async () => {
    const dir = path.join(ws, "docs", "recap-open");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "annotations.json");
    await fs.writeFile(file, "{secret-token-value");
    try {
      const r = await run("get_annotations", { workspace: ws, flow: "recap-open" });
      expect(r.ok).toBe(false);
      expect(errorOf(r)).toBe("docs/recap-open/annotations.json is not valid JSON");
      expect(errorOf(r)).not.toContain("secret-token-value");
      expect(hintOf(r)).toContain("run_flows");
    } finally {
      await fs.rm(file, { force: true });
    }
  });

  it("get_run_artifacts says run_flows creates the output when a flow has none", async () => {
    const r = await run("get_run_artifacts", { workspace: ws, flow: "ghost" });
    expect(r.ok).toBe(true);
    expect(hintOf(r)).toContain('"ghost"');
    expect(hintOf(r)).toContain("run_flows");
  });

  it("push_pack names a .docsxai.json that is not JSON", async () => {
    const r = await run("push_pack", { workspace: badCfgWs });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toBe(".docsxai.json is not valid JSON");
    expect(hintOf(r)).toContain("valid JSON");
  });

  it("pull_pack names the missing backend keys", async () => {
    const r = await run("pull_pack", { workspace: ws });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toContain("backend_url");
    expect(hintOf(r)).toContain("push_pack");
  });

  it("init_workspace only suggests force when the directory is not empty", async () => {
    const r = await run("init_workspace", { dir: ws });
    expect(hintOf(r)).toContain("force: true");
    expect(hintOf(r)).toContain("overwrites");
  });

  it("a flow-file error from any tool carries a hint", () => {
    const r = toFailure(new FlowFileError('no flow named "x"'));
    expect(r.ok).toBe(false);
    expect(r.hint).toContain("list_flows");
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
