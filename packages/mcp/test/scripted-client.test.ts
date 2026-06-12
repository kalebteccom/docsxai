// Scripted MCP client — the acceptance evidence that a *non-Claude* MCP client can drive the
// whole surface: an in-process linked client/server pair over the SDK's InMemoryTransport runs
// initialize → tools/list → init_workspace → doc-pack introspection → a real-Chromium run_flows
// against the engine's toy-site fixture served over loopback node:http.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocsxaiMcpServer, SERVER_NAME, TOOL_DEFINITIONS } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const toySiteDir = path.resolve(here, "../../engine/test/fixtures/toy-site");
const fixtureFlow = path.resolve(here, "../../engine/test/fixtures/recap-open.flow.yaml");

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const EXPECTED_TOOLS = [
  "init_workspace",
  "run_flows",
  "render_viewer",
  "lint_flows",
  "flow_tree",
  "diagnose_halt",
  "style_check",
  "zip_pack",
  "push_pack",
  "pull_pack",
  "list_flows",
  "get_annotations",
  "get_run_artifacts",
  "plugins_list",
];

async function connect(defaultWorkspace?: string): Promise<Client> {
  const server = createDocsxaiMcpServer(defaultWorkspace ? { defaultWorkspace } : {});
  const client = new Client({ name: "scripted-non-claude-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface CallResult {
  ok: boolean;
  isError: boolean;
  [k: string]: unknown;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallResult> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  const parsed = JSON.parse(content[0]!.text) as { ok: boolean; [k: string]: unknown };
  return { ...parsed, isError: res.isError === true };
}

describe("scripted client — initialize + tools/list", () => {
  it("initializes and reports the server identity", async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    await client.close();
  });

  it("lists every tool with an object input schema", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description).toBeTruthy();
    }
    await client.close();
  });

  it("registry and wire agree on the tool set", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      TOOL_DEFINITIONS.map((d) => d.name).sort(),
    );
    await client.close();
  });

  it("rejects schema-invalid arguments at the protocol layer", async () => {
    const client = await connect();
    // Depending on the SDK layer the violation surfaces as an MCP error or an isError result —
    // either way the call must not succeed.
    let rejected = false;
    try {
      const res = await client.callTool({
        name: "run_flows",
        arguments: { concurrency: 0, workspace: "/nonexistent" },
      });
      rejected = res.isError === true;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    await client.close();
  });
});

describe("scripted client — init_workspace", () => {
  it("scaffolds a workspace into a temp dir", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-init-"));
    try {
      const client = await connect();
      const r = await call(client, "init_workspace", { dir: path.join(tmp, "ws") });
      expect(r.ok).toBe(true);
      expect(r.dir).toBe(path.join(tmp, "ws"));
      await fs.access(path.join(tmp, "ws", ".site-docs.json"));
      await client.close();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("scripted client — fixture-workspace introspection", () => {
  let tmp: string;
  let ws: string;
  let client: Client;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-fixture-"));
    ws = path.join(tmp, "ws");
    client = await connect(ws); // default workspace — calls below omit `workspace`
    const init = await call(client, "init_workspace", { dir: ws, auth: "none" });
    expect(init.ok).toBe(true);
    await fs.copyFile(fixtureFlow, path.join(ws, "flows", "recap-open.flow.yaml"));
  });

  afterAll(async () => {
    await client.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("list_flows summarises names/steps/extends/environment", async () => {
    const r = await call(client, "list_flows");
    expect(r.ok).toBe(true);
    const flows = r.flows as Array<Record<string, unknown>>;
    expect(flows).toHaveLength(1);
    expect(flows[0]!.name).toBe("recap-open");
    expect(flows[0]!.stepCount).toBe(2);
    expect((flows[0]!.steps as Array<{ id: string }>).map((s) => s.id)).toEqual([
      "open-app",
      "open-sidebar",
    ]);
    expect(flows[0]!.extends).toBeUndefined();
  });

  it("lint_flows surfaces the fixture flow's R002 annotation-anchor warning", async () => {
    const r = await call(client, "lint_flows");
    expect(r.ok).toBe(true);
    expect(r.flowsLinted).toEqual(["recap-open"]);
    const issues = r.issues as Array<{ code: string; severity: string; stepId: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("R002");
    expect(issues[0]!.stepId).toBe("open-sidebar");
    expect(r.summary).toEqual({ errors: 0, warnings: 1, infos: 0 });
    expect(r.clean).toBe(false);
  });

  it("flow_tree shows the fixture flow as a root with no issues", async () => {
    const r = await call(client, "flow_tree");
    expect(r.ok).toBe(true);
    expect((r.roots as Array<{ name: string }>).map((n) => n.name)).toEqual(["recap-open"]);
    expect(r.clean).toBe(true);
  });

  it("get_annotations before any run fails with a run_flows hint", async () => {
    const r = await call(client, "get_annotations", { flow: "recap-open" });
    expect(r.ok).toBe(false);
    expect(r.isError).toBe(true);
    expect(String(r.hint)).toContain("run_flows");
  });

  it("style_check initialises and validates the style artifacts", async () => {
    const r = await call(client, "style_check");
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.clean).toBe(true);
    await fs.access(path.join(ws, "docs", "style.yaml"));
  });

  it("zip_pack writes a deterministic archive next to the workspace", async () => {
    const r = await call(client, "zip_pack");
    expect(r.ok).toBe(true);
    expect(r.output).toBe(`${ws}.zip`);
    expect((r.entries as string[]).length).toBeGreaterThan(0);
    await fs.access(r.output as string);
  });

  it("plugins_list reports an empty configured set", async () => {
    const r = await call(client, "plugins_list");
    expect(r.ok).toBe(true);
    expect(r.configured).toBe(0);
    expect(r.loaded).toBe(0);
  });

  it("get_run_artifacts is empty before any run", async () => {
    const r = await call(client, "get_run_artifacts");
    expect(r.ok).toBe(true);
    expect(r.flows).toEqual([]);
  });

  it("diagnose_halt reports static recommendations for a known step", async () => {
    const r = await call(client, "diagnose_halt", { flow: "recap-open", step: "open-sidebar" });
    expect(r.ok).toBe(true);
    const report = r.report as { step: { resolvedSelector?: string }; recommendations: unknown[] };
    expect(report.step.resolvedSelector).toBe("#play-recap");
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it("diagnose_halt on an unknown step fails with the merged step list", async () => {
    const r = await call(client, "diagnose_halt", { flow: "recap-open", step: "nope" });
    expect(r.ok).toBe(false);
    expect(String(r.hint)).toContain("open-sidebar");
  });
});

describe.skipIf(!chromiumAvailable)(
  "scripted client — run_flows against the toy site (real Chromium)",
  () => {
    let tmp: string;
    let ws: string;
    let client: Client;
    let httpServer: Server;
    let baseUrl: string;

    beforeAll(async () => {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-run-"));
      ws = path.join(tmp, "ws");
      client = await connect();
      const init = await call(client, "init_workspace", { dir: ws, auth: "none" });
      expect(init.ok).toBe(true);
      await fs.copyFile(fixtureFlow, path.join(ws, "flows", "recap-open.flow.yaml"));

      // Loopback static server over the engine's toy-site fixture (keystone pattern).
      httpServer = createServer((req, res) => {
        const rel = new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/+/, "");
        const file = path.join(toySiteDir, rel === "" ? "index.html" : rel);
        void fs
          .readFile(file)
          .then((data) => {
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(data);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end("not found");
          });
      });
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`;
    }, 60_000);

    afterAll(async () => {
      await client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it("runs the fixture flow and reports per-flow ok + artifact paths", async () => {
      const r = await call(client, "run_flows", { workspace: ws, baseUrl });
      expect(r.ok).toBe(true);
      expect(r.allOk).toBe(true);
      const flows = r.flows as Array<{
        flow: string;
        ok: boolean;
        stepsExecuted: string[];
        artifacts: { annotations: string; screenshots: string[] };
      }>;
      expect(flows).toHaveLength(1);
      expect(flows[0]!.ok).toBe(true);
      expect(flows[0]!.stepsExecuted).toEqual(["open-app", "open-sidebar"]);
      expect(flows[0]!.artifacts.screenshots.length).toBeGreaterThan(0);
      for (const shot of flows[0]!.artifacts.screenshots) {
        expect((await fs.stat(shot)).size).toBeGreaterThan(0);
      }
    }, 60_000);

    it("get_annotations then returns the run's annotation records", async () => {
      const r = await call(client, "get_annotations", { workspace: ws, flow: "recap-open" });
      expect(r.ok).toBe(true);
      const annotations = r.annotations as {
        flow: string;
        annotations: Array<{ step: string; selector: string }>;
      };
      expect(annotations.flow).toBe("recap-open");
      expect(annotations.annotations).toHaveLength(1);
      expect(annotations.annotations[0]!.step).toBe("open-sidebar");
      expect(annotations.annotations[0]!.selector).toBe("#play-recap");
    });

    it("get_run_artifacts lists the emitted paths only", async () => {
      const r = await call(client, "get_run_artifacts", { workspace: ws });
      expect(r.ok).toBe(true);
      const flows = r.flows as Array<{
        flow: string;
        annotations?: string;
        screenshots: string[];
      }>;
      expect(flows).toHaveLength(1);
      expect(flows[0]!.flow).toBe("recap-open");
      expect(flows[0]!.annotations).toBeTruthy();
      expect(flows[0]!.screenshots.some((p) => p.endsWith("open-sidebar.png"))).toBe(true);
    });

    it("run_flows halts with a halt cause when the target never appears", async () => {
      const haltWs = path.join(tmp, "halt-ws");
      const init = await call(client, "init_workspace", { dir: haltWs, auth: "none" });
      expect(init.ok).toBe(true);
      const flowYaml = [
        "name: missing-target",
        "steps:",
        "  - id: open-app",
        "    action: navigate",
        "    value: index.html",
        "    wait_for: load",
        "  - id: wait-for-ghost",
        "    action: wait",
        '    wait_for: { selector: "#does-not-exist", timeout_ms: 1500 }',
        "",
      ].join("\n");
      await fs.writeFile(path.join(haltWs, "flows", "missing-target.flow.yaml"), flowYaml);
      const r = await call(client, "run_flows", { workspace: haltWs, baseUrl });
      expect(r.ok).toBe(true); // the tool ran; the flow halted
      expect(r.allOk).toBe(false);
      const flows = r.flows as Array<{ ok: boolean; haltStep?: string; error?: string }>;
      expect(flows[0]!.ok).toBe(false);
      expect(flows[0]!.haltStep).toBe("wait-for-ghost");
      expect(flows[0]!.error).toBeTruthy();
    }, 60_000);
  },
);

describe("scripted client — availability note", () => {
  it(
    chromiumAvailable
      ? "Chromium is available — run_flows suite ran"
      : "Chromium not installed — run_flows suite skipped (npx playwright install chromium)",
    () => {
      expect(typeof chromiumAvailable).toBe("boolean");
    },
  );
});
