// A `.auth` that is a file: run_flows names it and the move that fixes it, where it used to say
// the session was "missing or expired".

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initWorkspace } from "@docsxai/engine";
import { TOOL_DEFINITIONS } from "../src/index.js";

let tmp: string;
let ws: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-mcp-authdir-"));
  ws = path.join(tmp, "ws");
  await initWorkspace({ dir: ws, auth: "manual-capture" });
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nlocators: { b: '#b' }\nsteps:\n  - id: s\n    action: hover\n    target: $b\n    success: { visible: $b }\n",
  );
  await fs.rm(path.join(ws, ".auth"), { recursive: true });
  await fs.writeFile(path.join(ws, ".auth"), "x");
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("run_flows with a file at .auth", () => {
  it("names the file and gives the mv as hint", async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === "run_flows")!;
    const res = (await def.handler({ workspace: ws }, {})) as {
      ok: boolean;
      error?: string;
      hint?: string;
    };
    const file = path.join(ws, ".auth");
    expect(res.ok).toBe(false);
    expect(res.error).toContain(`${file} is a file, but docsxai needs a directory there`);
    expect(res.hint).toBe(`mv ${file} ${file}.bak, then rerun the command`);
  });
});
