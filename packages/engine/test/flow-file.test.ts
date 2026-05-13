import { describe, expect, it } from "vitest";
import { FlowFileError, locatorRefName, parseFlowFile, resolveFlowExtends, serializeFlowFile } from "../src/flow-file.js";

const SAMPLE = `
name: recap-create
prerequisites:
  - logged_in_as: editor
  - feature_flag: recap.enabled
locators:
  play_button: '[data-testid="play-recap"]'
  recap_panel: '#recap-sidebar'
steps:
  - id: open-sidebar
    action: click
    target: $play_button
    wait_for: network_idle
    success: { visible: $recap_panel }
    annotation:
      copy: "Click Play to open the recap sidebar"
      arrow: top-right
  - id: confirm-panel
    action: wait
    wait_for: { selector: $recap_panel }
`;

describe("parseFlowFile", () => {
  it("parses a valid flow-file and applies defaults", () => {
    const flow = parseFlowFile(SAMPLE, "sample.flow.yaml");
    expect(flow.name).toBe("recap-create");
    expect(flow.prerequisites).toEqual([{ logged_in_as: "editor" }, { feature_flag: "recap.enabled" }]);
    expect(flow.locators.play_button).toBe('[data-testid="play-recap"]');
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]!.id).toBe("open-sidebar");
    expect(flow.steps[0]!.annotation?.arrow).toBe("top-right");
  });

  it("round-trips through serialize → parse", () => {
    const a = parseFlowFile(SAMPLE);
    const b = parseFlowFile(serializeFlowFile(a));
    expect(b).toEqual(a);
  });

  it("rejects invalid YAML", () => {
    expect(() => parseFlowFile("name: [unclosed", "x")).toThrow(FlowFileError);
  });

  it("rejects an unknown action", () => {
    const bad = `name: f\nsteps:\n  - id: s1\n    action: teleport\n`;
    expect(() => parseFlowFile(bad)).toThrow(FlowFileError);
  });

  it("rejects a step with no steps array", () => {
    expect(() => parseFlowFile("name: f\n")).toThrow(FlowFileError);
  });

  it("rejects unknown top-level keys (strict schema)", () => {
    const bad = `name: f\nsteps:\n  - id: s1\n    action: wait\nbogus: 1\n`;
    expect(() => parseFlowFile(bad)).toThrow(FlowFileError);
  });

  it("rejects unresolved locator references", () => {
    const bad = `
name: f
locators: { known: '#a' }
steps:
  - id: s1
    action: click
    target: $unknown
`;
    expect(() => parseFlowFile(bad)).toThrow(/unresolved locator/i);
  });

  it("rejects a step that sets BOTH `annotation` and `annotations` (use one — annotations: [...] is the multi form)", () => {
    const bad = `
name: f
steps:
  - id: s
    action: wait
    annotation: { copy: "x" }
    annotations:
      - { copy: "y" }
`;
    expect(() => parseFlowFile(bad)).toThrow(/both `annotation` and `annotations`/);
  });

  it("rejects duplicate step ids", () => {
    const bad = `
name: f
steps:
  - id: dup
    action: wait
  - id: dup
    action: wait
`;
    expect(() => parseFlowFile(bad)).toThrow(/duplicate step id/i);
  });
});

describe("locatorRefName", () => {
  it("recognises $name references", () => {
    expect(locatorRefName("$play_button")).toBe("play_button");
    expect(locatorRefName("#raw-selector")).toBeNull();
    expect(locatorRefName('[data-testid="x"]')).toBeNull();
  });
});

describe("resolveFlowExtends", () => {
  const PARENT = `
name: preamble
locators: { open_btn: '#open' }
steps:
  - id: nav
    action: navigate
    value: /app
  - id: open-thing
    action: click
    target: $open_btn
`;
  const CHILD = `
name: edit-thing
extends: preamble
locators: { save_btn: '#save' }
steps:
  - id: do-edit
    action: fill
    target: $open_btn          # references a parent locator — only resolves after the merge
    value: hello
  - id: save
    action: click
    target: $save_btn
`;
  const flows: Record<string, string> = { preamble: PARENT, "edit-thing": CHILD };
  const load = (name: string) => {
    const t = flows[name];
    if (t === undefined) throw new Error(`no flow ${name}`);
    return parseFlowFile(t, `${name}.flow.yaml`);
  };

  it("parses a flow with `extends`, deferring the locator-ref check to resolution", () => {
    expect(parseFlowFile(CHILD, "child.flow.yaml").extends).toBe("preamble"); // `$open_btn` ref doesn't fail here
  });

  it("a flow without `extends` is returned unchanged", async () => {
    const f = parseFlowFile(PARENT);
    expect(await resolveFlowExtends(f, load)).toBe(f);
  });

  it("merges: parent steps first, then this flow's; locators (child wins) + prerequisites; drops `extends`", async () => {
    const merged = await resolveFlowExtends(parseFlowFile(CHILD), load);
    expect(merged.extends).toBeUndefined();
    expect(merged.name).toBe("edit-thing");
    expect(merged.steps.map((s) => s.id)).toEqual(["nav", "open-thing", "do-edit", "save"]);
    expect(merged.locators).toEqual({ open_btn: "#open", save_btn: "#save" });
  });

  it("follows chains (A extends B extends C)", async () => {
    const chain: Record<string, string> = {
      c: `name: c\nlocators: { x: '#x' }\nsteps:\n  - id: c1\n    action: click\n    target: $x\n`,
      b: `name: b\nextends: c\nsteps:\n  - id: b1\n    action: wait\n`,
      a: `name: a\nextends: b\nsteps:\n  - id: a1\n    action: wait\n`,
    };
    const merged = await resolveFlowExtends(parseFlowFile(chain.a!), (n) => parseFlowFile(chain[n]!, `${n}.flow.yaml`));
    expect(merged.steps.map((s) => s.id)).toEqual(["c1", "b1", "a1"]);
  });

  it("rejects a step-id collision across the merge", async () => {
    const bad = parseFlowFile(`name: c\nextends: preamble\nsteps:\n  - id: nav\n    action: wait\n`);
    await expect(resolveFlowExtends(bad, load)).rejects.toThrow(/collides with a step inherited via `extends`/);
  });

  it("rejects an `extends` cycle", async () => {
    const cyclic: Record<string, string> = {
      a: `name: a\nextends: b\nsteps:\n  - id: sa\n    action: wait\n`,
      b: `name: b\nextends: a\nsteps:\n  - id: sb\n    action: wait\n`,
    };
    await expect(resolveFlowExtends(parseFlowFile(cyclic.a!), (n) => parseFlowFile(cyclic[n]!, `${n}.flow.yaml`))).rejects.toThrow(/cycle/i);
  });

  it("surfaces a missing `extends` target", async () => {
    await expect(resolveFlowExtends(parseFlowFile(`name: c\nextends: nonexistent\nsteps:\n  - id: s\n    action: wait\n`), load)).rejects.toThrow(/nonexistent/);
  });

  it("rejects a locator ref unresolved in both parent and child after the merge", async () => {
    await expect(resolveFlowExtends(parseFlowFile(`name: c\nextends: preamble\nsteps:\n  - id: s\n    action: click\n    target: $nowhere\n`), load)).rejects.toThrow(/unresolved locator/i);
  });
});
