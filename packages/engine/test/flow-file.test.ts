import { describe, expect, it } from "vitest";
import { FlowFileError, locatorRefName, parseFlowFile, serializeFlowFile } from "../src/flow-file.js";

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
