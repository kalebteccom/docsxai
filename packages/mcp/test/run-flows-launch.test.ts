// run_flows words a browser that will not start the way `docsxai run` does: the same reason in
// `error` and the same next step in `hint`. The launcher is stubbed with the message Playwright
// throws, so no browser starts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const MISSING =
  "browserType.launchPersistentContext: Executable doesn't exist at /home/u/.cache/ms-playwright/chromium-1/chrome\n" +
  "╔════════════════════════════════════════════════════════════╗\n" +
  "║     npx playwright install                                 ║\n" +
  "╚════════════════════════════════════════════════════════════╝";
const REFUSED =
  "browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222\nCall log:\n  - <ws preparing>";

const launch = vi.hoisted(() => ({ message: "" }));
vi.mock("@docsxai/engine", async (orig) => ({
  ...(await orig<typeof import("@docsxai/engine")>()),
  launchPlaywrightSession: () => Promise.reject(new Error(launch.message)),
}));
const { TOOL_DEFINITIONS } = await import("../src/index.js");
const { describeBrowserLaunch } = await import("@docsxai/engine");

let tmp: string;
let ws: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-launch-"));
  ws = path.join(tmp, "ws");
  const { initWorkspace } = await import("@docsxai/engine");
  await initWorkspace({ dir: ws, auth: "none" });
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nlocators: { b: '#b' }\nsteps:\n  - id: s\n    action: hover\n    target: $b\n    success: { visible: $b }\n",
  );
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function runFlows(args: Record<string, unknown> = {}) {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "run_flows")!;
  const res = (await def.handler({ workspace: ws, ...args }, {})) as {
    flows: Array<{ ok: boolean; error?: string; hint?: string }>;
  };
  return res.flows[0]!;
}

describe("run_flows, browser will not start", () => {
  it("names a missing Chromium like the CLI, with the install command as hint", async () => {
    launch.message = MISSING;
    const want = describeBrowserLaunch(MISSING);
    const flow = await runFlows();
    expect(flow.ok).toBe(false);
    expect(flow.error).toBe(want.reason);
    expect(flow.error).toBe("no Chromium binary found");
    expect(flow.hint).toBe(want.next);
    expect(flow.hint).toContain("npx playwright-core install chromium");
    expect(flow.error).not.toContain("╔");
  });

  it("names a refused --cdp endpoint like the CLI", async () => {
    launch.message = REFUSED;
    const want = describeBrowserLaunch(REFUSED, "http://127.0.0.1:9222");
    const flow = await runFlows({ cdp: "http://127.0.0.1:9222" });
    expect(flow.error).toBe(want.reason);
    expect(flow.hint).toBe(want.next);
    expect(flow.error).not.toContain("Call log");
  });
});
