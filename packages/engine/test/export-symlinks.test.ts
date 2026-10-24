// `export adf` and `export playwright` read flow files, step markdown and screenshots from the
// workspace. One that is a symlink to a file outside the workspace is left out, so a workspace
// taken from a repo cannot make an export carry (or point a publisher at) an arbitrary local file.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectDocPackToAdf } from "../src/export/adf.js";
import { exportWorkspaceFlowsAsPlaywrightTests } from "../src/export/playwright-test.js";

let tmp = "";
let ws = "";
let outside = "";

const FLOW = (name: string): string =>
  `name: ${name}\nsteps:\n  - id: s1\n    action: navigate\n    value: /\n`;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-export-links-"));
  ws = path.join(tmp, "ws");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs", "real", "burned"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs", "real", "screenshots"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(ws, "flows", "real.flow.yaml"), FLOW("real"), "utf8");
  await fs.writeFile(path.join(outside, "secret.md"), "TOP-SECRET", "utf8");
  await fs.writeFile(path.join(outside, "secret.png"), "TOP-SECRET-PNG");
  await fs.writeFile(path.join(outside, "evil.flow.yaml"), FLOW("evil"), "utf8");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("export adf and symlinks out of the workspace", () => {
  it("leaves out a linked step markdown file and linked screenshots", async () => {
    await fs.symlink(path.join(outside, "secret.md"), path.join(ws, "docs", "real", "s1.md"));
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(ws, "docs", "real", "burned", "s1.png"),
    );
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(ws, "docs", "real", "screenshots", "s1.png"),
    );
    const projection = await projectDocPackToAdf({ workspaceDir: ws });
    const text = JSON.stringify(projection);
    expect(text).not.toContain("TOP-SECRET");
    expect(text).not.toContain(outside);
    expect(projection.documents.flatMap((d) => d.attachments)).toEqual([]);
  });

  it("falls back to the clean screenshot when only the burned one is linked out", async () => {
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(ws, "docs", "real", "burned", "s1.png"),
    );
    await fs.writeFile(path.join(ws, "docs", "real", "screenshots", "s1.png"), "CLEAN");
    const projection = await projectDocPackToAdf({ workspaceDir: ws });
    const attachments = projection.documents.flatMap((d) => d.attachments);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.sourcePath).toBe(path.join(ws, "docs", "real", "screenshots", "s1.png"));
  });

  it("leaves out a linked flow file", async () => {
    await fs.symlink(
      path.join(outside, "evil.flow.yaml"),
      path.join(ws, "flows", "evil.flow.yaml"),
    );
    const projection = await projectDocPackToAdf({ workspaceDir: ws });
    expect(JSON.stringify(projection)).not.toContain("evil");
    await expect(projectDocPackToAdf({ workspaceDir: ws, flows: ["evil"] })).rejects.toThrow(
      /no flow named "evil"/,
    );
  });

  it("still reads a flow file that links to another file inside the workspace", async () => {
    await fs.symlink(
      path.join(ws, "flows", "real.flow.yaml"),
      path.join(ws, "flows", "alias.flow.yaml"),
    );
    const projection = await projectDocPackToAdf({ workspaceDir: ws, flows: ["alias"] });
    expect(JSON.stringify(projection)).toContain("real");
  });
});

describe("export playwright and symlinks out of the workspace", () => {
  it("leaves out a linked flow file", async () => {
    await fs.symlink(
      path.join(outside, "evil.flow.yaml"),
      path.join(ws, "flows", "evil.flow.yaml"),
    );
    const specs = await exportWorkspaceFlowsAsPlaywrightTests({ workspaceDir: ws });
    expect(specs.map((s) => s.flowName)).toEqual(["real"]);
    await expect(
      exportWorkspaceFlowsAsPlaywrightTests({ workspaceDir: ws, flows: ["evil"] }),
    ).rejects.toThrow(/no flow named "evil"/);
  });

  it("leaves out every flow when flows/ itself links outside", async () => {
    await fs.rm(path.join(ws, "flows"), { recursive: true });
    await fs.symlink(outside, path.join(ws, "flows"));
    const specs = await exportWorkspaceFlowsAsPlaywrightTests({ workspaceDir: ws });
    expect(specs).toEqual([]);
  });
});
