// The docs show `docsxai-viewer` commands: the viewer README, the burn and pack guides, the runbook and
// the public-surface table. Each shell block is read against the usage line `docsxai-viewer --help`
// prints (arguments, required flags, flags that take no value), and each code span against the flags
// of its command. The engine's `docsxai` commands are checked in
// packages/engine/test/docs-cli-usage.test.ts.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USAGE } from "../src/cli-usage.js";
import {
  docInvocations,
  docsMarkdownFiles,
  invocationProblems,
  parseUsageEntry,
} from "../../../scripts/cli-usage-support.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const read = (file: string): string => readFileSync(path.join(repo, file), "utf8");

/** The entries of the `Usage:` block, continuation lines joined. */
function usageLines(text: string): string[] {
  const start = text.indexOf("Usage:\n");
  const end = text.indexOf("\n\n", start);
  return text
    .slice(start + "Usage:\n".length, end)
    .split("\n")
    .map((l) => l.trim());
}

const grammars = usageLines(USAGE).map(parseUsageEntry);

const problemsWith = (invocation: string, strict: boolean): string[] =>
  invocationProblems(grammars, invocation, { strict });

describe("the viewer usage text", () => {
  it("lists build, burn, site and pack, and each has its flags", () => {
    expect(grammars.map((g) => g.command[0] ?? "--version")).toEqual([
      "build",
      "burn",
      "site",
      "pack",
      "pack",
      "--version",
    ]);
    expect([...grammars[1]!.flags.keys()]).toContain("--max-overlap");
  });

  it("rejects an invocation the viewer would exit 2 on", () => {
    expect(problemsWith("build docs", true)[0]).toMatch(/missing <out-dir>/);
    expect(problemsWith("burn", true)[0]).toMatch(/missing <workspace>/);
    expect(problemsWith("pack ws --check", true)[0]).toMatch(/--against is required/);
    expect(problemsWith("site ws --acent x", true)[0]).toMatch(/--acent is not a flag/);
    expect(problemsWith("build docs out --flow a --flow b --lang es", true)).toEqual([]);
  });
});

describe("docsxai-viewer in the docs", () => {
  for (const file of docsMarkdownFiles(repo)) {
    const found = docInvocations(read(file)).filter((m) => m.bin === "docsxai-viewer");
    if (found.length === 0) continue;
    it(`${file}: every docsxai-viewer invocation fits its usage line`, () => {
      const problems = found
        .filter((m) => !/\[--|\]\.\.\.|<version>/.test(m.command))
        .flatMap((m) =>
          problemsWith(m.command, m.kind === "block").map(
            (p) => `${file}:${m.line}: \`docsxai-viewer ${m.command}\`: ${p}`,
          ),
        );
      expect(problems).toEqual([]);
    });
  }
});
