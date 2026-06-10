import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalibrateError, calibrate, extractFlowFile } from "../src/calibrate.js";
import { parseFlowFile } from "../src/flow-file.js";

const FLOW_YAML = `name: recap-open
locators: { play_button: '#play', recap_panel: '#recap' }
steps:
  - id: open-sidebar
    action: click
    target: $play_button
    success: { visible: $recap_panel }
    annotation: { copy: "Click Play to open the recap sidebar", arrow: top-right }
`;

const FLOW_GUIDE_MD = `# Recap — open the Recap sidebar

Some prose describing the flow for humans.

\`\`\`yaml
${FLOW_YAML}\`\`\`

More prose after the block.
`;

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-calibrate-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("extractFlowFile", () => {
  it("accepts a flow-file given directly as YAML", () => {
    expect(extractFlowFile(FLOW_YAML).name).toBe("recap-open");
  });
  it("extracts the flow-file from a ```yaml block in a Markdown guide", () => {
    const flow = extractFlowFile(FLOW_GUIDE_MD, "guide.md");
    expect(flow.name).toBe("recap-open");
    expect(flow.steps).toHaveLength(1);
  });
  it("rejects loose prose with a message pointing at the agent path", () => {
    expect(() =>
      extractFlowFile("Just click the play button, then check the panel opens.", "loose.md"),
    ).toThrow(CalibrateError);
    try {
      extractFlowFile("Just click the play button.", "loose.md");
    } catch (e) {
      expect((e as Error).message).toMatch(/site-docs:calibrate skill/);
    }
  });
  it("rejects a malformed yaml block with the schema error", () => {
    expect(() => extractFlowFile("```yaml\nname: f\nsteps: []\n```", "bad.md")).toThrow(
      CalibrateError,
    );
  });
});

describe("calibrate", () => {
  it("writes flows/<name>.flow.yaml + a default docs/style.yaml", async () => {
    const ws = path.join(tmp, "ws");
    await fs.mkdir(ws, { recursive: true });
    const r = await calibrate({
      workspaceDir: ws,
      fromText: FLOW_GUIDE_MD,
      fromSource: "guide.md",
    });
    expect(r.flow.name).toBe("recap-open");
    expect(r.wroteStyle).toBe(true);
    // round-trips: the written flow-file re-parses to the same flow
    const written = parseFlowFile(await fs.readFile(r.flowFilePath, "utf8"));
    expect(written).toEqual(r.flow);
    const style = await fs.readFile(r.stylePath, "utf8");
    expect(style).toMatch(/site-docs\/style@1/);
    expect(style).toMatch(/pruning_rules/);
  });
  it("respects --name (override the flow name in the output path)", async () => {
    const ws = path.join(tmp, "ws2");
    const r = await calibrate({ workspaceDir: ws, fromText: FLOW_YAML, flowName: "renamed" });
    expect(r.flowFilePath).toBe(path.join(ws, "flows", "renamed.flow.yaml"));
  });
  it("leaves an existing docs/style.yaml alone", async () => {
    const ws = path.join(tmp, "ws3");
    await fs.mkdir(path.join(ws, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "docs", "style.yaml"),
      "schema: site-docs/style@1\ncustom: true\n",
    );
    const r = await calibrate({ workspaceDir: ws, fromText: FLOW_YAML });
    expect(r.wroteStyle).toBe(false);
    expect(await fs.readFile(r.stylePath, "utf8")).toMatch(/custom: true/);
  });
});
