// The nightly drift recipes under examples/ci/ are sample files adopters copy. This suite keeps them
// honest without running any pipeline: each file parses as YAML and has the shape its CI system
// needs (schedule only, report upload on failure), every `docsxai` command line in it names a command
// and flags that `docsxai --help` prints, the copies of the recipes in docs/ci-recipes.md are
// identical to the files, and none of them is wired into this repository's own CI.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { USAGE } from "../src/cli-usage.js";
import { hasFlag, usageByCommand } from "../../../scripts/cli-usage-support.js";
import { docsxaiCommands, scriptsIn, shellLines } from "./fixtures/ci-recipe-commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const read = (...p: string[]) => readFileSync(path.join(repo, ...p), "utf8");

const EXAMPLES = {
  github: "examples/ci/github-actions-nightly-drift.yml",
  gitlab: "examples/ci/gitlab-ci-nightly-drift.yml",
  woodpecker: "examples/ci/woodpecker-nightly-drift.yml",
} as const;

const VERIFY = /^docsxai run \S+ .*--verify-determinism\b/;
const DIFF = /^docsxai diff \S+ .*--against \S+ .*--fail-on fail\b/;

// ---------------------------------------------------------------------------
// Help text and command extraction
// ---------------------------------------------------------------------------

const usage = usageByCommand(USAGE);

function fencedBlocks(markdown: string): { lang: string; body: string; before: string }[] {
  const blocks: { lang: string; body: string; before: string }[] = [];
  const re = /```(\w+)\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    blocks.push({
      lang: m[1]!,
      body: m[2]!,
      before: markdown.slice(Math.max(0, m.index - 200), m.index),
    });
  }
  return blocks;
}

/** The package arguments of the `npm install` / `pnpm add` lines among shell lines. */
function installedPackages(lines: string[]): string[] {
  return lines
    .filter((l) => /^(?:npm (?:install|i)|pnpm add)\b/.test(l))
    .flatMap((l) => l.split(/\s+/).slice(2))
    .filter((t) => !t.startsWith("-"));
}

const DOCSXAI_PACKAGE = /^(?:@docsxai\/[\w-]+|docsxai)(?:@|$)/;
/** A docsxai package with a version, a range or a dist-tag after the name. */
const PINNED_PACKAGE = /^(?:@docsxai\/[\w-]+|docsxai)@[\w.^~*-]+$/;

function expectPinnedInstall(lines: string[], where: string): void {
  const packages = installedPackages(lines).filter((t) => DOCSXAI_PACKAGE.test(t));
  expect(packages.length, `${where}: no docsxai install line found`).toBeGreaterThan(0);
  for (const pkg of packages) {
    expect(pkg, `${where}: \`${pkg}\` has no version or dist-tag`).toMatch(PINNED_PACKAGE);
  }
}

function expectKnownToHelp(commands: string[], where: string): void {
  expect(commands.length, `${where}: no docsxai command found`).toBeGreaterThan(0);
  for (const cmd of commands) {
    const tokens = cmd.split(/\s+/);
    const key = tokens[1] === "export" ? `export ${tokens[2]}` : tokens[1]!;
    const entry = usage.get(key);
    expect(
      entry,
      `${where}: \`${cmd}\` uses "${key}", which \`docsxai --help\` does not list`,
    ).toBeDefined();
    for (const flag of tokens.filter((t) => t.startsWith("--"))) {
      const name = flag.split("=")[0]!;
      expect(
        hasFlag(entry!, name),
        `${where}: \`${cmd}\` uses ${name}, which the help does not list for "${key}"`,
      ).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// The helpers themselves
// ---------------------------------------------------------------------------

describe("help parsing helpers", () => {
  it("lists the commands the recipes rely on, with their flags", () => {
    expect(usage.get("run")).toContain("--verify-determinism");
    expect(usage.get("run")).toContain("--runs");
    expect(usage.get("diff")).toContain("--against");
    expect(usage.get("diff")).toContain("--fail-on");
    expect(usage.has("export adf")).toBe(true);
    expect(usage.has("baseline")).toBe(true);
  });

  it("joins continuations and cuts a command at a pipe or redirect", () => {
    const lines = shellLines(
      "# note\ndocsxai run ws \\\n  --flow a | tee out.md\n\ndocsxai diff ws > d.md",
    );
    expect(docsxaiCommands(lines)).toEqual(["docsxai run ws --flow a", "docsxai diff ws"]);
  });

  it("finds a bare docsxai install and accepts a tag, a version and a range", () => {
    expect(() => expectPinnedInstall(["npm install --global docsxai"], "x")).toThrow(
      /no version or dist-tag/,
    );
    expect(() => expectPinnedInstall(["pnpm add -g @docsxai/engine docsxai@next"], "x")).toThrow(
      /`@docsxai\/engine` has no version/,
    );
    expect(() => expectPinnedInstall(["npx playwright-core install chromium"], "x")).toThrow(
      /no docsxai install line/,
    );
    for (const ok of ["docsxai@next", "docsxai@0.3.0", "docsxai@0.3.0-rc.1", "docsxai@^0.3.0"]) {
      expectPinnedInstall([`npm install --global ${ok}`], "x");
    }
  });

  it("rejects a command or flag the help does not know", () => {
    expect(() => expectKnownToHelp(["docsxai frobnicate ws"], "x")).toThrow(/does not list/);
    expect(() => expectKnownToHelp(["docsxai run ws --verify-everything"], "x")).toThrow(
      /does not list for "run"/,
    );
  });
});

// ---------------------------------------------------------------------------
// The example files
// ---------------------------------------------------------------------------

describe("examples/ci recipes", () => {
  for (const [name, file] of Object.entries(EXAMPLES)) {
    describe(name, () => {
      const text = read(file);
      const doc: unknown = parse(text);

      it("parses as YAML", () => {
        expect(doc).toBeTypeOf("object");
      });

      it("runs verify-determinism, then diff against a baseline failing on fail", () => {
        const commands = docsxaiCommands(scriptsIn(doc));
        const verify = commands.findIndex((c) => VERIFY.test(c));
        const diff = commands.findIndex((c) => DIFF.test(c));
        expect(verify, "no `docsxai run … --verify-determinism`").toBeGreaterThanOrEqual(0);
        expect(diff, "no `docsxai diff … --against … --fail-on fail`").toBeGreaterThan(verify);
        expect(commands[verify]).toContain("--format md");
        expect(commands[diff]).toContain("--format md");
      });

      it("uses only commands and flags that `docsxai --help` lists", () => {
        expectKnownToHelp(docsxaiCommands(scriptsIn(doc)), file);
      });

      it("installs docsxai with a version or dist-tag, because latest has no pack or verify", () => {
        expectPinnedInstall(scriptsIn(doc), file);
      });

      it("produces and uploads both markdown reports", () => {
        expect(text).toContain("determinism-report.md");
        expect(text).toContain("drift-report.md");
        expect(text).toMatch(/upload|artifacts/);
      });

      it("warns against running browser capture in per-PR pipelines", () => {
        expect(text).toMatch(/per-PR pipelines on shared runners/);
      });
    });
  }

  it("github: schedule and workflow_dispatch only, reports uploaded even on failure", () => {
    const wf = parse(read(EXAMPLES.github)) as {
      on: Record<string, unknown>;
      jobs: Record<
        string,
        { steps: { uses?: string; if?: string; with?: Record<string, string> }[] }
      >;
    };
    expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(wf.on.schedule).toEqual([{ cron: expect.stringMatching(/^\S+ \S+ \S+ \S+ \S+$/) }]);
    const upload = Object.values(wf.jobs)
      .flatMap((j) => j.steps)
      .find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("always()");
    expect(upload?.with?.path).toContain("determinism-report.md");
    expect(upload?.with?.path).toContain("drift-report.md");
  });

  it("gitlab: scheduled pipelines only, artifacts kept even on failure", () => {
    const ci = parse(read(EXAMPLES.gitlab)) as Record<
      string,
      { rules: { if: string }[]; artifacts: { when: string; paths: string[] } }
    >;
    const job = Object.values(ci)[0]!;
    expect(job.rules).toEqual([{ if: '$CI_PIPELINE_SOURCE == "schedule"' }]);
    expect(job.artifacts.when).toBe("always");
    expect(job.artifacts.paths).toEqual(["determinism-report.md", "drift-report.md"]);
  });

  it("woodpecker: cron only, reports shown and uploaded even on failure", () => {
    const wp = parse(read(EXAMPLES.woodpecker)) as {
      when: { event: string; cron?: string }[];
      steps: { name: string; when?: { status?: string[] }[] }[];
    };
    expect(wp.when).toEqual([{ event: "cron", cron: "docsxai-nightly-drift" }]);
    const after = wp.steps.filter((s) => s.name !== "drift-check");
    expect(after.length).toBeGreaterThanOrEqual(2);
    for (const step of after) {
      expect(step.when).toEqual([{ status: ["success", "failure"] }]);
    }
  });
});

// ---------------------------------------------------------------------------
// docs/ci-recipes.md
// ---------------------------------------------------------------------------

describe("docs/ci-recipes.md", () => {
  const md = read("docs", "ci-recipes.md");
  const blocks = fencedBlocks(md);

  it("embeds each example file verbatim under its marker", () => {
    for (const file of Object.values(EXAMPLES)) {
      const block = blocks.find((b) => b.before.includes(`<!-- example: ${file} -->`));
      expect(block, `no block marked for ${file}`).toBeDefined();
      expect(block!.lang).toBe("yaml");
      expect(block!.body.trim()).toBe(read(file).trim());
    }
  });

  it("only uses commands and flags that `docsxai --help` lists, in every yaml and shell block", () => {
    const commands: string[] = [];
    for (const b of blocks) {
      if (b.lang === "yaml") commands.push(...docsxaiCommands(scriptsIn(parse(b.body))));
      else if (b.lang === "bash" || b.lang === "sh")
        commands.push(...docsxaiCommands(shellLines(b.body)));
    }
    expectKnownToHelp(commands, "docs/ci-recipes.md");
  });

  it("pins the docsxai install in every embedded recipe and in the prose", () => {
    for (const b of blocks.filter((x) => x.before.includes("<!-- example:"))) {
      expectPinnedInstall(scriptsIn(parse(b.body)), "docs/ci-recipes.md");
    }
    expect(md).not.toMatch(/(?:install --global|add -g) docsxai(?![@\w-])/);
  });

  it("says browser capture does not belong in per-PR pipelines on shared runners", () => {
    expect(md).toMatch(/Do not run browser capture in per-PR pipelines on shared runners/);
  });
});

// ---------------------------------------------------------------------------
// This repository's own CI stays untouched
// ---------------------------------------------------------------------------

describe("this repository's own CI", () => {
  it("does not run the nightly drift recipes", () => {
    const workflows = readdirSync(path.join(repo, ".github", "workflows"));
    for (const f of workflows) {
      const text = read(".github", "workflows", f);
      expect(text, `.github/workflows/${f}`).not.toMatch(/verify-determinism|nightly-drift/);
    }
    const pipelines = readdirSync(path.join(repo, ".woodpecker"));
    expect(pipelines).toContain("ci.yaml");
    for (const f of pipelines) {
      expect(read(".woodpecker", f), `.woodpecker/${f}`).not.toMatch(
        /verify-determinism|nightly-drift/,
      );
    }
  });
});
