import { describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { type BoundingBox } from "../src/doc-pack.js";
import { type ActionableState, type BrowserDriver, FlowExecutionError, inferHaltCause, runFlow } from "../src/flow-runtime.js";

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
  async currentUrl() {
    return this.url;
  }
  async count(s: string) {
    return this.visible.has(s) ? 1 : 0;
  }
  async textOf(s: string) {
    return this.texts.get(s) ?? null;
  }
  boundingBoxError?: Error;
  async boundingBox(s: string) {
    if (this.boundingBoxError) throw this.boundingBoxError;
    return this.boxes.get(s) ?? null;
  }
  async screenshot(p: string) {
    this.rec(`screenshot ${p}`);
  }
  actionableMap = new Map<string, ActionableState>();
  async actionable(s: string): Promise<ActionableState> {
    return this.actionableMap.get(s) ?? "actionable";
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

  it("a halt message carries context (the current URL + match count)", async () => {
    const d = new FakeDriver(); // #recap never visible
    d.url = "https://app.example/dash";
    await expect(runFlow(parseFlowFile(FLOW), d)).rejects.toThrow(/app\.example\/dash.*element\(s\) match/s);
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

  it("startFrom skips every step BEFORE the named one (the inverse of stopAfter); execution resumes there", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    const flow = parseFlowFile(FLOW);
    const r = await runFlow(flow, d, { startFrom: "open-sidebar" });
    expect(r.steps.map((s) => s.id)).toEqual(["open-sidebar", "type-title"]);
    expect(d.calls).not.toContain("goto https://app.example/dash"); // first step was skipped
    expect(d.calls).toContain("click #play"); // execution resumed at open-sidebar
  });

  it("startFrom + stopAfter together run an arbitrary [first, last] range", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    const r = await runFlow(parseFlowFile(FLOW), d, { startFrom: "open-sidebar", stopAfter: "open-sidebar" });
    expect(r.steps.map((s) => s.id)).toEqual(["open-sidebar"]);
  });

  it("startFrom throws fast if the named step doesn't exist (catch the typo before launching)", async () => {
    await expect(runFlow(parseFlowFile(FLOW), new FakeDriver(), { startFrom: "no-such-step" })).rejects.toThrow(
      /startFrom: no step with id "no-such-step"/,
    );
  });

  it("stopAfter runs only a prefix of the flow (up to & including that step)", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    const flow = parseFlowFile(FLOW);
    const r = await runFlow(flow, d, { stopAfter: "open-sidebar" });
    expect(r.steps.map((s) => s.id)).toEqual(["open-app", "open-sidebar"]); // not "type-title"
    expect(d.calls).not.toContain("fill #title=My recap");
  });

  it("an `optional: true` step that fails is SKIPPED, not halted — the flow continues", async () => {
    // The optional step targets an element that never becomes visible; its success check would
    // throw. With optional:true the flow keeps going to the next step instead of halting.
    const d = new FakeDriver();
    d.visible.add("#after"); // the LATER step's success target is present; the optional one's isn't
    const flow = parseFlowFile(`
name: f
locators: { maybe_modal_ok: '#modal-ok', after: '#after' }
steps:
  - id: dismiss-optional-modal
    action: click
    target: $maybe_modal_ok
    success: { visible: $maybe_modal_ok }
    optional: true
  - id: continue
    action: click
    target: $after
    success: { visible: $after }
`);
    const r = await runFlow(flow, d, { captureDocs: false });
    expect(r.steps.map((s) => s.id)).toEqual(["continue"]); // the optional step was skipped, not in executed
    expect(d.calls).toContain("click #after");
  });

  it("an `optional: true` step that SUCCEEDS behaves like a normal step (executed + annotation)", async () => {
    const d = new FakeDriver();
    d.visible.add("#modal-ok");
    d.boxes.set("#modal-ok", { x: 1, y: 2, width: 3, height: 4 });
    const flow = parseFlowFile(`
name: f
locators: { modal_ok: '#modal-ok' }
steps:
  - id: dismiss-optional-modal
    action: click
    target: $modal_ok
    success: { visible: $modal_ok }
    optional: true
    annotation: { copy: "Dismiss the confirmation if it appears", target: $modal_ok }
`);
    const r = await runFlow(flow, d);
    expect(r.steps.map((s) => s.id)).toEqual(["dismiss-optional-modal"]);
    expect(r.annotations.annotations).toHaveLength(1);
    expect(r.annotations.annotations[0]!.copy).toBe("Dismiss the confirmation if it appears");
  });

  it("a non-optional step that fails still halts (optional doesn't change default behaviour)", async () => {
    const d = new FakeDriver(); // #recap never visible → checkSuccess throws
    await expect(runFlow(parseFlowFile(FLOW), d)).rejects.toMatchObject({ name: "FlowExecutionError", stepId: "open-sidebar" });
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

  it("dumps a halt screenshot (docs/<flow>/halts/<step>.png) when a step halts, and the error message points at it", async () => {
    const d = new FakeDriver(); // #recap never visible → checkSuccess throws
    await expect(runFlow(parseFlowFile(FLOW), d)).rejects.toThrow(/halt screenshot: docs\/recap-open\/halts\/open-sidebar\.png/);
    expect(d.calls).toContain("screenshot docs/recap-open/halts/open-sidebar.png");
  });

  it("skips an annotation when its target's boundingBox fails (e.g. the target was unmounted post-action) — run continues", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boundingBoxError = new Error("locator.boundingBox: Timeout 2000ms exceeded");
    const r = await runFlow(parseFlowFile(FLOW), d); // does not throw
    expect(r.steps.map((s) => s.id)).toEqual(["open-app", "open-sidebar", "type-title"]);
    expect(r.annotations.annotations).toHaveLength(0); // the annotation was skipped, not the run
  });

  it("a step with `annotations: [...]` produces one indexed record per call-out (1-based)", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boxes.set("#a", { x: 1, y: 2, width: 3, height: 4 });
    d.boxes.set("#b", { x: 5, y: 6, width: 7, height: 8 });
    const flow = parseFlowFile(`
name: f
locators: { play: '#play', recap: '#recap', a: '#a', b: '#b' }
steps:
  - id: act
    action: click
    target: $play
    wait_for: { selector: $recap }
    success: { visible: $recap }
    annotations:
      - { copy: "first thing", target: $a, arrow: top }
      - { copy: "second thing", target: $b, arrow: bottom }
`);
    const r = await runFlow(flow, d);
    expect(r.annotations.annotations).toHaveLength(2);
    expect(r.annotations.annotations[0]).toMatchObject({ step: "act", selector: "#a", copy: "first thing", index: 1 });
    expect(r.annotations.annotations[1]).toMatchObject({ step: "act", selector: "#b", copy: "second thing", index: 2 });
  });

  it("a single `annotation` (back-compat) produces one record with NO index (un-numbered)", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boxes.set("#play", { x: 1, y: 1, width: 10, height: 10 });
    const r = await runFlow(parseFlowFile(FLOW), d);
    const ann = r.annotations.annotations.find((a) => a.step === "open-sidebar")!;
    expect(ann.copy).toBe("Click Play to open the recap sidebar");
    expect(ann.index).toBeUndefined();
  });

  it("propagates `annotation.nudge` from the flow-file into the emitted AnnotationRecord", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boxes.set("#play", { x: 1, y: 2, width: 3, height: 4 });
    const flow = parseFlowFile(`
name: f
locators: { play: '#play', recap: '#recap' }
steps:
  - id: act
    action: click
    target: $play
    wait_for: { selector: $recap }
    success: { visible: $recap }
    annotation: { copy: "nudged", target: $play, nudge: { x: 30, y: -12 } }
`);
    const r = await runFlow(flow, d);
    expect(r.annotations.annotations[0]!.nudge).toEqual({ x: 30, y: -12 });
  });

  it("annotation.target overrides the anchor — point the halo at a different element from the action's target", async () => {
    const d = new FakeDriver();
    d.visible.add("#recap");
    d.boxes.set("#appeared", { x: 100, y: 50, width: 200, height: 60 });
    const flow = parseFlowFile(`
name: f
locators: { trigger: '#trigger', recap: '#recap', appeared: '#appeared' }
steps:
  - id: act
    action: click
    target: $trigger
    wait_for: { selector: $recap }
    success: { visible: $recap }
    annotation: { copy: "the new state", arrow: top, target: $appeared }
`);
    const r = await runFlow(flow, d);
    expect(r.annotations.annotations).toHaveLength(1);
    expect(r.annotations.annotations[0]!.selector).toBe("#appeared");
    expect(r.annotations.annotations[0]!.bounding_box).toEqual({ x: 100, y: 50, width: 200, height: 60 });
  });

  it("throws on an unresolved locator ref via a custom resolver", async () => {
    const flow = parseFlowFile(`name: f\nlocators: { a: '#a' }\nsteps:\n  - id: s1\n    action: click\n    target: $a\n`);
    const d = new FakeDriver();
    await expect(runFlow(flow, d, { resolveLocator: () => undefined })).rejects.toThrow(/unresolved locator/i);
  });

  it("prepends a `[cause: …]` prefix to the halt message when the underlying error names a Playwright actionability state", async () => {
    class DisabledDriver extends FakeDriver {
      override async fill(s: string, v: string) {
        // Simulate Playwright's actionability log for a disabled input
        throw new Error(
          `page.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('${s}')\n  - locator resolved to <input value="00" disabled />\n  - element is disabled\n  - retrying...`,
        );
      }
    }
    const d = new DisabledDriver();
    const flow = parseFlowFile(`
name: f
locators: { t: '#t' }
steps:
  - id: edit
    action: fill
    target: $t
    value: '00'
`);
    await expect(runFlow(flow, d, { captureDocs: false })).rejects.toThrow(/^\[target is disabled\]/);
  });
});

describe("inferHaltCause", () => {
  it("recognises 'element is disabled'", () => {
    expect(inferHaltCause("page.fill: ... element is disabled, retrying...")).toMatch(/disabled/i);
  });

  it("recognises 'element is not visible'", () => {
    expect(inferHaltCause("page.click: ... element is not visible")).toMatch(/not visible/i);
  });

  it("recognises 'strict mode violation' and suggests the disambiguation", () => {
    expect(inferHaltCause("page.click: strict mode violation: resolved to 3 elements")).toMatch(/:visible \/ :nth-match/);
  });

  it("recognises 'element is not attached' (the unmounted-target case)", () => {
    expect(inferHaltCause("page.click: ... element is not attached to the DOM")).toMatch(/detached/i);
  });

  it("falls back to 'target resolved to <…>' when no actionability hint matches (captures the opening tag — which is where Playwright puts the attributes)", () => {
    expect(inferHaltCause("page.fill: Timeout exceeded.\nlocator resolved to <input disabled value=\"00\" />")).toMatch(
      /target resolved to <input disabled value="00" \/>/,
    );
  });

  it("returns undefined when the error doesn't match any known pattern", () => {
    expect(inferHaltCause("network error: ECONNREFUSED")).toBeUndefined();
  });
});
