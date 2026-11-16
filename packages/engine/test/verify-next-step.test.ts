import { describe, expect, it } from "vitest";
import type { ArtefactDifference } from "../src/verify-compare.js";
import { nextStepFor } from "../src/verify-next-step.js";
import {
  buildVerifyReport,
  formatVerifyReportMarkdown,
  formatVerifyReportText,
} from "../src/verify-report.js";

function diff(extra: Partial<ArtefactDifference>): ArtefactDifference {
  return { path: "docs/f/x", run: 2, kind: "bytes", hint: "sizes differ", ...extra };
}

describe("nextStepFor", () => {
  it("says what to pin for each kind of difference", () => {
    expect(nextStepFor(diff({ kind: "missing" }))).toMatch(/one run only/);
    expect(nextStepFor(diff({ kind: "extra" }))).toMatch(/one run only/);
    expect(nextStepFor(diff({ kind: "png" }))).toMatch(/environment\.clock/);
    expect(nextStepFor(diff({ kind: "text" }))).toMatch(/dates, counters/);
    expect(nextStepFor(diff({ kind: "bytes" }))).toMatch(/timestamp or random seed/);
  });
  it("tells a size change from a changed region", () => {
    const sized = diff({
      kind: "png",
      dimension_change: { a: { width: 1, height: 2 }, b: { width: 3, height: 2 } },
    });
    expect(nextStepFor(sized)).toMatch(/viewport/);
  });
  it("tells a time or id key from any other key", () => {
    expect(nextStepFor(diff({ kind: "json", json_path: "steps[0].started_at" }))).toMatch(
      /time or id/,
    );
    expect(nextStepFor(diff({ kind: "json", json_path: "annotations[0].id" }))).toMatch(
      /time or id/,
    );
    expect(nextStepFor(diff({ kind: "json", json_path: "annotations[0].bounding_box.x" }))).toMatch(
      /locator or label/,
    );
  });
});

describe("report renderings", () => {
  const report = buildVerifyReport({
    runs: 2,
    flows: ["f"],
    artefactsCompared: 3,
    differences: [diff({ kind: "text", line: 4, hint: "line 4 differs" })],
    halts: [],
    promoted: false,
  });
  it("prints the next step under the cause in text and markdown", () => {
    expect(formatVerifyReportText(report)).toContain(
      "  cause: line 4 differs\n  try: A text artefact differs.",
    );
    expect(formatVerifyReportMarkdown(report)).toContain("- Try: A text artefact differs.");
  });
  it("leaves the JSON report shape alone", () => {
    expect(JSON.stringify(report)).not.toContain("try");
  });
});
