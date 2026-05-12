import { describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { type BoundingBox } from "../src/doc-pack.js";
import { type BrowserDriver, FlowExecutionError, runFlow } from "../src/flow-runtime.js";

class FakeDriver implements BrowserDriver {
  calls: string[] = [];
  visible = new Set<string>();
  url = "https://app.example/";
  texts = new Map<string, string>();
  boxes = new Map<string, BoundingBox>();

  private rec(s: string) {
    this.calls.push(s);
  }
  async goto(url: string) {
    this.rec(`goto ${url}`);
    this.url = url;
  }
  async click(s: string) {
    this.rec(`click ${s}`);
  }
  async fill(s: string, v: string) {
    this.rec(`fill ${s}=${v}`);
  }
  async press(s: string | null, k: string) {
    this.rec(`press ${s ?? "<page>"} ${k}`);
  }
  async hover(s: string) {
    this.rec(`hover ${s}`);
  }
  async selectOption(s: string, v: string) {
    this.rec(`select ${s}=${v}`);
  }
  async setChecked(s: string, c: boolean) {
    this.rec(`setChecked ${s}=${c}`);
  }
  async waitForNetworkIdle() {
    this.rec("waitNetworkIdle");
  }
  async waitForLoad() {
    this.rec("waitLoad");
  }
  async waitForElementStable(s: string) {
    this.rec(`waitStable ${s}`);
  }
  async waitForSelector(s: string, t?: number) {
    this.rec(`waitSelector ${s}${t ? ` (${t}ms)` : ""}`);
  }
  async waitForTimeout(ms: number) {
    this.rec(`waitTimeout ${ms}`);
  }
  async isVisible(s: string) {
    return this.visible.has(s);
  }
  async urlMatches(p: string) {
    return new RegExp(p).test(this.url);
  }
  async textContains(s: string, t: string) {
    return (this.texts.get(s) ?? "").includes(t);
  }
  async boundingBox(s: string) {
    return this.boxes.get(s) ?? null;
  }
  async screenshot(p: string) {
    this.rec(`screenshot ${p}`);
  }
}

const FLOW = `
name: recap-open
locators:
  play_button: '#play'
  recap_panel: '#recap'
steps:
  - id: open-app
    action: navigate
    value: 'https://app.example/dash'
    wait_for: network_idle
  - id: open-sidebar
    action: click
    target: $play_button
    wait_for: { selector: $recap_panel }
    success: { visible: $recap_panel }
    annotation: { copy: "Click Play to open the recap sidebar", arrow: top-right }
  - id: type-title
    action: fill
    target: '#title'
    value: 'My recap'
`;

describe("runFlow", () => {
  it("executes actions, applies waits, checks success, and emits annotations", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boxes.set("#play", { x: 10, y: 20, width: 30, height: 12 });
    const flow = parseFlowFile(FLOW);
    const r = await runFlow(flow, d);

    expect(r.flow).toBe("recap-open");
    expect(r.steps.map((s) => s.id)).toEqual(["open-app", "open-sidebar", "type-title"]);
    expect(d.calls).toEqual([
      "goto https://app.example/dash",
      "waitNetworkIdle",
      "click #play",
      "waitSelector #recap",
      "screenshot docs/recap-open/screenshots/open-sidebar.png",
      "fill #title=My recap",
    ]);
    expect(r.annotations).toEqual({
      schema: "site-docs/annotations@1",
      flow: "recap-open",
      annotations: [
        {
          step: "open-sidebar",
          selector: "#play",
          bounding_box: { x: 10, y: 20, width: 30, height: 12 },
          copy: "Click Play to open the recap sidebar",
          arrow_style: "top-right",
        },
      ],
    });
    expect(r.steps[1]!.screenshot).toBe("docs/recap-open/screenshots/open-sidebar.png");
  });

  it("halts with FlowExecutionError when a success criterion fails", async () => {
    const d = new FakeDriver(); // #recap never visible
    const flow = parseFlowFile(FLOW);
    await expect(runFlow(flow, d)).rejects.toMatchObject({
      name: "FlowExecutionError",
      stepId: "open-sidebar",
    });
  });

  it("skips screenshot/annotation capture when captureDocs is false", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    const r = await runFlow(parseFlowFile(FLOW), d, { captureDocs: false });
    expect(d.calls).not.toContain("screenshot docs/recap-open/screenshots/open-sidebar.png");
    expect(r.annotations.annotations).toHaveLength(0);
    expect(r.steps[1]!.screenshot).toBeUndefined();
  });

  it("is deterministic — two runs against the same driver state produce equal results", async () => {
    const mk = () => {
      const d = new FakeDriver();
      d.visible.add("#recap");
      d.boxes.set("#play", { x: 1, y: 2, width: 3, height: 4 });
      return d;
    };
    const flow = parseFlowFile(FLOW);
    expect(await runFlow(flow, mk())).toEqual(await runFlow(flow, mk()));
  });

  it("stopAfter runs only a prefix of the flow (up to & including that step)", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    const flow = parseFlowFile(FLOW);
    const r = await runFlow(flow, d, { stopAfter: "open-sidebar" });
    expect(r.steps.map((s) => s.id)).toEqual(["open-app", "open-sidebar"]); // not "type-title"
    expect(d.calls).not.toContain("fill #title=My recap");
  });

  it("passes a per-step timeout_ms to waitForSelector (the 'wait for a slow backend op' primitive)", async () => {
    const d = new FakeDriver();
    d.visible.add("#done");
    const flow = parseFlowFile(`
name: slow
locators: { done: '#done' }
steps:
  - id: kick
    action: click
    target: '#go'
    wait_for: { selector: $done, timeout_ms: 180000 }
    success: { visible: $done }
`);
    await runFlow(flow, d, { captureDocs: false });
    expect(d.calls).toContain("waitSelector #done (180000ms)");
  });

  it("throws on an unresolved locator ref via a custom resolver", async () => {
    const flow = parseFlowFile(`name: f\nlocators: { a: '#a' }\nsteps:\n  - id: s1\n    action: click\n    target: $a\n`);
    const d = new FakeDriver();
    await expect(runFlow(flow, d, { resolveLocator: () => undefined })).rejects.toThrow(/unresolved locator/i);
  });
});
