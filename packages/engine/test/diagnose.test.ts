import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDiagnoseReport,
  type DiagnoseRecommendation,
  formatReportText,
  recommendFromActionable,
  recommendStatic,
} from "../src/diagnose.js";
import { parseFlowFile } from "../src/flow-file.js";

describe("recommendFromActionable", () => {
  const kinds = (recs: DiagnoseRecommendation[]) => recs.map((r) => r.kind);

  it("maps `not-found` → selector-tier recommendation", () => {
    expect(kinds(recommendFromActionable("not-found"))).toEqual(["selector"]);
  });

  it("maps `multiple-matches` → selector recommendation with disambiguation guidance", () => {
    const recs = recommendFromActionable("multiple-matches");
    expect(recs).toHaveLength(1);
    expect(recs[0]!.kind).toBe("selector");
    expect(recs[0]!.suggestion).toMatch(/:visible|:nth-match/);
  });

  it("maps `detached` → annotation_target recommendation (target unmounted post-action)", () => {
    expect(kinds(recommendFromActionable("detached"))).toEqual(["annotation_target"]);
  });

  it("maps `not-visible` → wait_for recommendation", () => {
    expect(kinds(recommendFromActionable("not-visible"))).toEqual(["wait_for"]);
  });

  it("maps `off-screen` and `covered` → split_step recommendations", () => {
    expect(kinds(recommendFromActionable("off-screen"))).toEqual(["split_step"]);
    expect(kinds(recommendFromActionable("covered"))).toEqual(["split_step"]);
  });

  it("maps `disabled` → investigate (not an automatic edit)", () => {
    expect(kinds(recommendFromActionable("disabled"))).toEqual(["investigate"]);
  });

  it("maps `actionable` → investigate (flake / success-criterion drift, not a selector issue)", () => {
    const recs = recommendFromActionable("actionable");
    expect(recs[0]!.kind).toBe("investigate");
    expect(recs[0]!.suggestion).toMatch(/network_idle|element_stable|success/);
  });
});

describe("recommendStatic", () => {
  const stepWithSuccess = (success: unknown) =>
    parseFlowFile(`name: f\nlocators: { x: '#x' }\nsteps:\n  - id: s\n    action: wait\n    success: ${JSON.stringify(success)}\n`).steps[0]!;

  it("surfaces the halt screenshot when one exists", () => {
    const step = parseFlowFile(`name: f\nsteps:\n  - id: s\n    action: wait\n`).steps[0]!;
    const recs = recommendStatic(step, { screenshotRelPath: "docs/f/halts/s.png" });
    expect(recs.find((r) => r.kind === "investigate")?.rationale).toMatch(/docs\/f\/halts\/s\.png/);
  });

  it("flags `text_contains` success as fragile", () => {
    const step = stepWithSuccess({ text_contains: { selector: "#x", text: "Done!" } });
    const recs = recommendStatic(step, {});
    expect(recs.find((r) => r.kind === "success")?.rationale).toMatch(/text_contains.*fragile/i);
  });

  it("doesn't flag visible/hidden success criteria as fragile", () => {
    const step = stepWithSuccess({ visible: "$x" });
    expect(recommendStatic(step, {}).find((r) => r.kind === "success")).toBeUndefined();
  });
});

describe("buildDiagnoseReport", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-diagnose-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns step + recommendations from the flow-file alone (no live probe, no halt screenshot)", async () => {
    const flow = parseFlowFile(`name: f\nlocators: { b: '#btn' }\nsteps:\n  - id: s\n    action: click\n    target: $b\n`);
    const r = await buildDiagnoseReport({
      workspace: tmp,
      flow,
      step: flow.steps[0]!,
      resolvedSelector: "#btn",
    });
    expect(r.flow).toBe("f");
    expect(r.step.id).toBe("s");
    expect(r.step.target).toBe("$b");
    expect(r.step.resolvedSelector).toBe("#btn");
    expect(r.halt.screenshotRelPath).toBeUndefined();
    expect(r.live).toBeUndefined();
    expect(r.recommendations).toEqual([]); // no halt, no success, no live → no recs
  });

  it("surfaces the halt screenshot when one exists on disk", async () => {
    const flow = parseFlowFile(`name: f\nsteps:\n  - id: s\n    action: wait\n`);
    const haltPath = path.join(tmp, "docs", "f", "halts", "s.png");
    await fs.mkdir(path.dirname(haltPath), { recursive: true });
    await fs.writeFile(haltPath, "fake png");
    const r = await buildDiagnoseReport({
      workspace: tmp,
      flow,
      step: flow.steps[0]!,
      haltScreenshotAbsPath: haltPath,
    });
    expect(r.halt.screenshotRelPath).toBe("docs/f/halts/s.png");
    expect(r.halt.screenshotAbsPath).toBe(haltPath);
    expect(r.recommendations.find((rec) => rec.kind === "investigate")).toBeDefined();
  });

  it("invokes liveProbe and merges its recommendations", async () => {
    const flow = parseFlowFile(`name: f\nlocators: { b: '#btn' }\nsteps:\n  - id: s\n    action: click\n    target: $b\n`);
    const r = await buildDiagnoseReport({
      workspace: tmp,
      flow,
      step: flow.steps[0]!,
      resolvedSelector: "#btn",
      liveProbe: async () => ({ cdpEndpoint: "http://localhost:9222", url: "https://app", actionable: "not-found", bbox: null }),
    });
    expect(r.live).toEqual({ cdpEndpoint: "http://localhost:9222", url: "https://app", actionable: "not-found", bbox: null });
    expect(r.recommendations.find((rec) => rec.kind === "selector")).toBeDefined();
  });
});

describe("formatReportText", () => {
  it("renders step + halt + live + recommendations in human-readable shape", () => {
    const text = formatReportText({
      workspace: "/tmp/ws",
      flow: "f",
      step: { id: "s", action: "click", target: "$b", resolvedSelector: "#btn", success: { visible: "$x" } },
      halt: { screenshotRelPath: "docs/f/halts/s.png" },
      live: { cdpEndpoint: "http://localhost:9222", url: "https://app", actionable: "multiple-matches", bbox: null },
      recommendations: [
        { kind: "selector", rationale: "two matches", suggestion: "add :visible" },
      ],
    });
    expect(text).toContain("diagnose: flow=f step=s");
    expect(text).toContain("target: $b (resolved: #btn)");
    expect(text).toContain("screenshot: docs/f/halts/s.png");
    expect(text).toContain("actionable: multiple-matches");
    expect(text).toContain("[selector] two matches");
    expect(text).toContain("→ add :visible");
  });
});
