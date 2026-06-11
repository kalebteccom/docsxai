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
  it('flags a step whose locator resolves to a bare `[data-foo="x"]` selector', async () => {
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

describe("lintFlow — R005 (extends target missing)", () => {
  const load = (n: string) => {
    if (n === "base") return parseFlowFile(`name: base\nsteps:\n  - id: b1\n    action: wait\n`);
    throw new Error(`extends target not found: ${n}`);
  };

  it("errors when `extends` names a flow the workspace doesn't have", async () => {
    const flow = parseFlowFile(`name: f\nextends: ghost\nsteps:\n  - id: s1\n    action: wait\n`);
    const issues = await lintFlow(flow, { loadFlow: load });
    expect(issues.find((i) => i.code === "R005")).toMatchObject({
      severity: "error",
      flow: "f",
    });
    expect(issues.find((i) => i.code === "R005")!.message).toContain("ghost");
  });

  it("does NOT error when the extends target exists", async () => {
    const flow = parseFlowFile(`name: f\nextends: base\nsteps:\n  - id: s1\n    action: wait\n`);
    const issues = await lintFlow(flow, { loadFlow: load });
    expect(issues.find((i) => i.code === "R005")).toBeUndefined();
  });

  it("does NOT error when loadFlow is omitted (single-flow lint can't resolve extends)", async () => {
    const flow = parseFlowFile(`name: f\nextends: ghost\nsteps:\n  - id: s1\n    action: wait\n`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R005")).toBeUndefined();
  });
});

describe("lintFlow — R006 (locator defined but never referenced)", () => {
  it("flags an unused locator", async () => {
    const flow = parseFlowFile(`
name: f
locators: { used: '#used', dead: '#dead' }
steps:
  - id: s1
    action: click
    target: $used
`);
    const issues = await lintFlow(flow);
    const r006 = issues.filter((i) => i.code === "R006");
    expect(r006).toHaveLength(1);
    expect(r006[0]!.message).toContain("`dead`");
  });

  it("counts redaction references as uses", async () => {
    const flow = parseFlowFile(`
name: f
locators: { used: '#used', masked: '#masked' }
redactions:
  - { selector: $masked }
steps:
  - id: s1
    action: click
    target: $used
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R006")).toBeUndefined();
  });

  it("counts wait/success/annotation references as uses", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', panel: '#panel', anchor: '#anchor' }
steps:
  - id: s1
    action: click
    target: $btn
    wait_for: { selector: $panel }
    success: { visible: $panel }
    annotation: { copy: "look here", target: $anchor }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R006")).toBeUndefined();
  });
});

describe("lintFlow — R007 (terminal step lacks success)", () => {
  it("warns when the flow's last step has no success criterion", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn' }
steps:
  - id: last-step
    action: click
    target: $btn
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R007")).toMatchObject({
      severity: "warning",
      stepId: "last-step",
    });
  });

  it("does NOT warn when the last step has success (earlier steps may omit it)", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn', done: '#done' }
steps:
  - id: mid
    action: click
    target: $btn
  - id: last-step
    action: click
    target: $btn
    success: { visible: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R007")).toBeUndefined();
  });
});

describe("lintFlow — R008 (un-guarded optional step)", () => {
  it("warns on `optional: true` with neither wait_for nor success", async () => {
    const flow = parseFlowFile(`
name: f
locators: { ok: '#ok', done: '#done' }
steps:
  - id: maybe-dismiss
    action: click
    target: $ok
    optional: true
  - id: end
    action: click
    target: $ok
    success: { visible: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R008")).toMatchObject({
      severity: "warning",
      stepId: "maybe-dismiss",
    });
  });

  it("does NOT warn when the optional step has a wait_for or a success", async () => {
    const flow = parseFlowFile(`
name: f
locators: { ok: '#ok', done: '#done' }
steps:
  - id: guarded-by-wait
    action: click
    target: $ok
    optional: true
    wait_for: { selector: $ok }
  - id: guarded-by-success
    action: click
    target: $ok
    optional: true
    success: { visible: $ok }
  - id: end
    action: click
    target: $ok
    success: { visible: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R008")).toBeUndefined();
  });
});

describe("lintFlow — R009 (selector-less element_stable)", () => {
  it("warns when wait_for: element_stable has no target to watch", async () => {
    const flow = parseFlowFile(`
name: f
locators: { done: '#done' }
steps:
  - id: settle
    action: wait
    wait_for: element_stable
  - id: end
    action: click
    target: $done
    success: { visible: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R009")).toMatchObject({
      severity: "warning",
      stepId: "settle",
    });
  });

  it("does NOT warn when the step has a target", async () => {
    const flow = parseFlowFile(`
name: f
locators: { panel: '#panel' }
steps:
  - id: settle
    action: click
    target: $panel
    wait_for: element_stable
    success: { visible: $panel }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R009")).toBeUndefined();
  });
});

describe("lintFlow — R010 (annotation anchored to a redacted element)", () => {
  it("warns when the annotation anchor matches a step-level redaction selector (via $ref)", async () => {
    const flow = parseFlowFile(`
name: f
locators: { secret: '#secret', done: '#done' }
steps:
  - id: show
    action: hover
    target: $secret
    redactions:
      - { selector: $secret }
    annotation: { copy: "your token" }
    success: { visible: $done }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R010")).toMatchObject({
      severity: "warning",
      stepId: "show",
    });
  });

  it("warns when a flow-level redaction masks the annotation's target override (ref vs inline selector)", async () => {
    const flow = parseFlowFile(`
name: f
locators: { secret: '#secret', btn: '#btn' }
redactions:
  - { selector: '#secret' }
steps:
  - id: show
    action: hover
    target: $btn
    annotation: { copy: "your token", target: $secret }
    success: { visible: $btn }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R010")).toBeDefined();
  });

  it("does NOT warn when the annotation anchors a different element", async () => {
    const flow = parseFlowFile(`
name: f
locators: { secret: '#secret', btn: '#btn' }
redactions:
  - { selector: $secret }
steps:
  - id: show
    action: hover
    target: $btn
    annotation: { copy: "the button" }
    success: { visible: $btn }
`);
    const issues = await lintFlow(flow);
    expect(issues.find((i) => i.code === "R010")).toBeUndefined();
  });
});

describe("lintFlow — extraRules (the injectable-rule hinge)", () => {
  it("runs injected rules after the built-ins and merges their issues", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn' }
steps:
  - id: s1
    action: click
    target: $btn
    success: { visible: $btn }
`);
    const seen: string[] = [];
    const rule = {
      code: "P001",
      run: (f: typeof flow) => {
        seen.push(f.name);
        return [
          { code: "P001", severity: "info" as const, flow: f.name, message: "injected rule ran" },
        ];
      },
    };
    const issues = await lintFlow(flow, { extraRules: [rule] });
    expect(seen).toEqual(["f"]);
    expect(issues.find((i) => i.code === "P001")).toMatchObject({ message: "injected rule ran" });
  });

  it("omitting extraRules keeps the original behaviour (backward compatible)", async () => {
    const flow = parseFlowFile(`
name: f
locators: { btn: '#btn' }
steps:
  - id: s1
    action: click
    target: $btn
    success: { visible: $btn }
`);
    expect(await lintFlow(flow)).toEqual([]);
  });
});

describe("formatIssuesText", () => {
  it("groups issues by flow and includes the summary", () => {
    const issues: LintIssue[] = [
      {
        code: "R002",
        severity: "warning",
        flow: "f",
        stepId: "s1",
        message: "msg",
        suggestion: "fix",
      },
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
