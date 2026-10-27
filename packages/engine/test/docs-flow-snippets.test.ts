// Flow files a new user copies out of the README and the docs have to parse with the real flow
// parser and lint without an error. Covers the README walkthrough (a heredoc in a shell block), the
// quickstart, the flow-file reference and the agent guidance: every yaml block with its own `steps:`
// list is a whole flow. The runbook's annotated format template (placeholders such as
// `<flow-name>`) is not one.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseFlowFile } from "../src/flow-file.js";
import { lintFlow } from "../src/flow-lint.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const FILES = [
  "README.md",
  "website/src/content/docs/getting-started/quickstart.md",
  "website/src/content/docs/reference/flow-file.md",
  "docs/agent-guidance.md",
];

/** Whole flows in a markdown text: yaml blocks and `<<'YAML'` heredocs that have a top-level `steps`. */
function flowsIn(markdown: string): { line: number; yaml: string }[] {
  const found: { line: number; yaml: string }[] = [];
  const re = /^```ya?ml\n([\s\S]*?)\n```$|<<'YAML'\n([\s\S]*?)\nYAML$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const yaml = m[1] ?? m[2]!;
    let doc: unknown;
    try {
      doc = parse(yaml);
    } catch {
      continue;
    }
    if (doc !== null && typeof doc === "object" && "steps" in doc && "name" in doc) {
      found.push({ line: markdown.slice(0, m.index).split("\n").length, yaml });
    }
  }
  return found;
}

describe("flow files in the docs", () => {
  it("finds the README walkthrough flow and the quickstart flow", () => {
    expect(flowsIn(readFileSync(path.join(repo, "README.md"), "utf8")).length).toBe(1);
    expect(
      flowsIn(
        readFileSync(
          path.join(repo, "website/src/content/docs/getting-started/quickstart.md"),
          "utf8",
        ),
      ).length,
    ).toBe(1);
  });

  it("lints the quickstart flow with no warning, so a newcomer's `docsxai lint` exits 0", async () => {
    const [flow] = flowsIn(
      readFileSync(
        path.join(repo, "website/src/content/docs/getting-started/quickstart.md"),
        "utf8",
      ),
    );
    const issues = await lintFlow(parseFlowFile(flow!.yaml, "quickstart"));
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("shows the quickstart's run lines in the format `run` prints", () => {
    const md = readFileSync(
      path.join(repo, "website/src/content/docs/getting-started/quickstart.md"),
      "utf8",
    );
    expect(md).toContain("run: open-reports, starting\n");
    expect(md).not.toMatch(/^run: .* \u2014 /m);
  });

  for (const file of FILES) {
    const flows = flowsIn(readFileSync(path.join(repo, file), "utf8"));
    for (const { line, yaml } of flows) {
      it(`${file}:${line} parses and lints without an error`, async () => {
        const flow = parseFlowFile(yaml, `${file}:${line}`);
        const issues = await lintFlow(flow);
        expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      });
    }
  }
});
