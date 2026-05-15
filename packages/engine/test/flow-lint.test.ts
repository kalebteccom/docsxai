import { describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { formatIssuesText, lintFlow, type LintIssue } from "../src/flow-lint.js";

describe("lintFlow — R002 (annotation on likely-unmounting action)", () => {
  it("warns when a click step has an annotation with no target override", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', appeared: '#appeared' }
steps:
  - id: open
    action: click
    target: $btn
    annotation: { copy: "open the thing" }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R002")).toMatchObject({
      severity: "warning",
      stepId: "open",
    });
  });

  it("does NOT warn when the annotation has its own target override", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', appeared: '#appeared' }
steps:
  - id: open
    action: click
    target: $btn
    annotation: { copy: "the appeared element", target: $appeared }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R002")).toBeUndefined();
  });

  it("warns on the plural `annotations: [...]` form too if any entry lacks target", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', a: '#a' }
steps:
  - id: open
    action: click
    target: $btn
    annotations:
      - { copy: "first", target: $a }
      - { copy: "second (no override)" }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R002")).toBeDefined();
  });

  it("does NOT warn on non-unmounting actions (wait/fill/hover)", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn' }
steps:
  - id: focus
    action: hover
    target: $btn
    annotation: { copy: "hover the button" }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R002")).toBeUndefined();
  });
});

describe("lintFlow — R003 (wait_for missing timeout_ms on long-async step)", () => {
  it("warns when step id contains a long-async keyword and timeout_ms is unset", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', done: '#done' }
steps:
  - id: generate-scripts
    action: click
    target: $btn
    wait_for: { selector: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R003")).toMatchObject({
      severity: "warning",
      stepId: "generate-scripts",
    });
  });

  it("warns when the target locator name carries the keyword", async () => {
    const flow = parseFlowFile(`
name: f
locators: { upload_btn: '#u', done: '#done' }
steps:
  - id: kick
    action: click
    target: $upload_btn
    wait_for: { selector: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R003")).toBeDefined();
  });

  it("does NOT warn when timeout_ms is set", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', done: '#done' }
steps:
  - id: generate-scripts
    action: click
    target: $btn
    wait_for: { selector: $done, timeout_ms: 180000 }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R003")).toBeUndefined();
  });

  it("does NOT warn on non-long-async steps", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', done: '#done' }
steps:
  - id: click-thing
    action: click
    target: $btn
    wait_for: { selector: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R003")).toBeUndefined();
  });
});

describe("lintFlow — R004 (bare data-* selector)", () => {
  it("flags a step whose locator resolves to a bare `[data-foo=\"x\"]` selector", async () => {
    const flow = parseFlowFile(`
name: f
locators: { gen_btn: '[data-type="generate-button"]' }
steps:
  - id: click
    action: click
    target: $gen_btn
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R004")).toMatchObject({
      severity: "info",
      stepId: "click",
    });
  });

  it("does NOT flag a selector that's already qualified with :visible", async () => {
    const flow = parseFlowFile(`
name: f
locators: { gen_btn: '[data-type="generate-button"]:visible' }
steps:
  - id: click
    action: click
    target: $gen_btn
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R004")).toBeUndefined();
  });

  it("does NOT flag a non-data-* selector", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#play' }
steps:
  - id: click
    action: click
    target: $btn
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R004")).toBeUndefined();
  });
});

describe("lintFlow — R001 (deep extends chain)", () => {
  const chain: Record<string, string> = {
    a: `name: a\nlocators: { x: '#x' }\nsteps:\n  - id: a1\n    action: click\n    target: $x\n`,
    b: `name: b\nextends: a\nsteps:\n  - id: b1\n    action: wait\n`,
    c: `name: c\nextends: b\nsteps:\n  - id: c1\n    action: wait\n`,
    d: `name: d\nextends: c\nsteps:\n  - id: d1\n    action: wait\n`,
  };
  const load = async (n: string) => parseFlowFile(chain[n]!, `${n}.flow.yaml`);

  it("flags a chain of depth 4", async () => {
    const flow = parseFlowFile(chain.d!, "d.flow.yaml");
    const issues = await lintFlow(flow, { loadFlow: load });
    expect(issues.find((i) => i.code === "R001")).toMatchObject({ severity: "info", flow: "d" });
  });

  it("does NOT flag a chain of depth 3", async () => {
    const flow = parseFlowFile(chain.c!, "c.flow.yaml");
    const issues = await lintFlow(flow, { loadFlow: load });
    expect(issues.find((i) => i.code === "R001")).toBeUndefined();
  });

  it("does NOT flag when loadFlow is omitted (single-flow lint)", async () => {
    const flow = parseFlowFile(chain.d!, "d.flow.yaml");
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R001")).toBeUndefined();
  });
});

describe("formatIssuesText", () => {
  it("groups issues by flow and includes the summary", () => {
    const issues: LintIssue[] = [
      { code: "R002", severity: "warning", flow: "f", stepId: "s1", message: "msg", suggestion: "fix" },
      { code: "R004", severity: "info", flow: "f", stepId: "s2", message: "msg" },
    ];
    const out = formatIssuesText(issues);
    expect(out).toContain("flow f");
    expect(out).toContain("R002 [warning]");
    expect(out).toContain("R004 [info]");
    expect(out).toContain("0 errors, 1 warning, 1 info");
  });

  it("returns ✓ no issues when empty", () => {
    expect(formatIssuesText([])).toContain("no issues");
  });
});
