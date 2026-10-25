// The docs show whole `docsxai` invocations: shell blocks in the README, the package READMEs, the
// plugin commands and skills, `docs/*.md`, the docs site and the examples. docs-cli-mentions.test.ts
// checks that each command and flag exists. This suite reads each invocation against its usage entry
// the way the CLI does: required arguments, required flags, enumerated values (`--format text|md|json`),
// flags that take no value, and extra arguments. It also holds the CLI reference's synopsis block to the
// exact usage lines `docsxai --help` prints, and the public-surface table to the code. The viewer's own
// commands are checked in packages/viewer/test/docs-cli-usage.test.ts.

import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USAGE } from "../src/cli-usage.js";
import { KNOWN_DOCSX_ENV_VARS } from "../src/doctor-checks.js";
import {
  docInvocations,
  docsMarkdownFiles,
  invocationProblems,
  parseUsageEntry,
  usageEntries,
} from "../../../scripts/cli-usage-support.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const read = (file: string): string => readFileSync(path.join(repo, file), "utf8");

const entries = usageEntries(USAGE);
const grammars = entries.map(parseUsageEntry);

/** Commands the docs may name that the usage text no longer lists, with the reason. */
const RETIRED: Record<string, string> = {
  drift: "retired in 0.3.0, still runs as `pack --check` with a deprecation warning",
};

/** Words that follow `docsxai` in code spans without naming a command. */
const NOT_COMMANDS: Record<string, string> = {
  manifest: "the title of the page a publisher plugin keeps",
};

function problemsWith(invocation: string, strict: boolean): string[] {
  const first = invocation.trim().split(/\s+/)[0] ?? "";
  if (first in RETIRED || first in NOT_COMMANDS || first.startsWith("<")) return [];
  return invocationProblems(grammars, invocation, { strict });
}

describe("the usage grammar", () => {
  it("reads required and optional parts of a usage entry", () => {
    const run = parseUsageEntry(
      "docsxai run <workspace-dir> --verify-determinism [--runs <2-5>] [--format text|md|json]",
    );
    expect(run.command).toEqual(["run"]);
    expect(run.positionals).toEqual([{ required: true, token: "<workspace-dir>" }]);
    expect(run.flags.get("--verify-determinism")).toEqual({ required: true, value: null });
    expect(run.flags.get("--format")).toEqual({ required: false, value: "text|md|json" });
    expect(parseUsageEntry("docsxai export adf <workspace-dir>").command).toEqual([
      "export",
      "adf",
    ]);
    expect(parseUsageEntry("docsxai doctor [<workspace-dir>]").positionals).toEqual([
      { required: false, token: "<workspace-dir>" },
    ]);
  });

  it("accepts invocations that fit and a code span that names only a flag", () => {
    for (const ok of [
      "init ~/docsxai/hello --example",
      "run ws --flow a --stop-after b --pause",
      "run ws --verify-determinism --runs 3 --format md > report.md",
      "run $WORKSPACE --verify-determinism   # two runs, byte-compared",
      "pack ws --check --against dir --threshold 1",
      "export adf ws --mode single --title t",
      "plugins list ws --format json",
      "login --backend-url http://h --oauth ws",
      "doctor",
      "diagnose ws --flow a --step b --format json",
    ]) {
      expect(problemsWith(ok, true), ok).toEqual([]);
    }
    expect(problemsWith("burn --no-connector-outline", false)).toEqual([]);
    expect(problemsWith("drift ws --against dir", true)).toEqual([]);
  });

  it("rejects what the CLI would exit 2 on", () => {
    expect(problemsWith("run", true)[0]).toMatch(/missing <workspace-dir>/);
    expect(problemsWith("calibrate ws", true)[0]).toMatch(/--from is required/);
    expect(problemsWith("diagnose ws --flow a", true)[0]).toMatch(/--step is required/);
    expect(problemsWith("login ws", true).join()).toMatch(/--backend-url is required/);
    expect(problemsWith("lint ws --format xml", true)[0]).toMatch(/allows text\|json/);
    expect(problemsWith("run ws --pause=yes", true)[0]).toMatch(/--pause takes no value/);
    expect(problemsWith("run ws extra", true)[0]).toMatch(/extra argument extra/);
    expect(problemsWith("plugins nope ws", true)[0]).toMatch(/allows <list\|info\|sync>/);
    expect(problemsWith("pack ws --check", true)[0]).toMatch(/--against is required/);
    expect(problemsWith("run ws --flwo x", true)[0]).toMatch(/--flwo is not a flag/);
    expect(problemsWith("frobnicate ws", true)[0]).toMatch(/not a command/);
  });
});

describe("the CLI reference synopsis", () => {
  it("is the usage block of `docsxai --help`, line for line", () => {
    const md = read("website/src/content/docs/reference/cli.md");
    const block = /## Synopsis\n\n```[^\n]*\n([\s\S]*?)\n```/.exec(md)?.[1];
    expect(block, "no Synopsis block in reference/cli.md").toBeDefined();
    const shown: string[] = [];
    for (const line of block!.split("\n")) {
      if (/^docsxai /.test(line)) shown.push(line.trim());
      else shown[shown.length - 1] += ` ${line.trim()}`;
    }
    expect(shown.map((l) => l.replace(/\s+/g, " "))).toEqual(entries);
  });
});

describe("shell blocks in the docs", () => {
  const files = docsMarkdownFiles(repo);

  it("cover the files a reader copies commands from", () => {
    for (const must of [
      "README.md",
      "docs/agent-runbook.md",
      "docs/ci-recipes.md",
      "packages/engine/README.md",
      "packages/plugin/commands/run.md",
      "packages/plugin/skills/calibrate/SKILL.md",
      "website/src/content/docs/reference/cli.md",
    ]) {
      expect(files).toContain(must);
    }
  });

  for (const file of files) {
    const found = docInvocations(read(file)).filter((m) => m.bin === "docsxai");
    if (found.length === 0) continue;
    it(`${file}: every docsxai invocation fits its usage line`, () => {
      const problems = found
        .filter((m) => !/\[--|\]\.\.\.|\[<|\[flags\]|\bflags\b/.test(m.command))
        .flatMap((m) =>
          problemsWith(m.command, m.kind === "block").map(
            (p) => `${file}:${m.line}: \`docsxai ${m.command}\`: ${p}`,
          ),
        );
      expect(problems).toEqual([]);
    });
  }
});

describe("the lint rule table in the troubleshooting guide", () => {
  /** `code: "R004", severity: "info"` pairs in the two modules that emit rules. */
  function emitted(): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of ["flow-lint.ts", "flow-matrix-lint.ts"]) {
      const src = read(`packages/engine/src/${file}`);
      for (const m of src.matchAll(/code: "(R\d{3})",\s*severity: "(\w+)"/g)) out.set(m[1]!, m[2]!);
    }
    return out;
  }

  it("has a row for every rule the linter emits, with the severity it emits", () => {
    const md = read("website/src/content/docs/guides/troubleshooting.md");
    const shown = new Map(
      [...md.matchAll(/^\| (R\d{3}) +\| (\w+) +\|/gm)].map((m) => [m[1]!, m[2]!] as const),
    );
    expect(shown).toEqual(emitted());
  });

  it("is the table the CLI reference points at", () => {
    const md = read("website/src/content/docs/reference/cli.md");
    const last = [...emitted().keys()].sort().pop()!;
    expect(md).toContain(`R001-${last}`);
  });
});

describe("the doctor env row", () => {
  it("lists in the CLI reference the variable names the code knows", () => {
    const md = read("website/src/content/docs/reference/cli.md").replace(/\s+/g, " ");
    const sentence = /the names it knows are (.+?)\. And the/.exec(md)?.[1];
    expect(sentence, "no `the names it knows are ...` sentence in reference/cli.md").toBeDefined();
    const shown = [...sentence!.matchAll(/`(DOCSX_[A-Z0-9_]+)`/g)].map((m) => m[1]!);
    expect([...shown].sort()).toEqual([...KNOWN_DOCSX_ENV_VARS].sort());
  });
});

describe("docs/public-surface.md", () => {
  const md = read("docs/public-surface.md");
  const rows = md
    .split("\n")
    .filter((l) => /^\| (?:CLI|ENV|VIEW|PACK)-\d+ /.test(l))
    .map((l) => ({ id: l.split("|")[1]!.trim(), text: l.split("|").slice(2, 3).join("") }));
  const commands = new Set(grammars.map((g) => g.command[0]).filter((c): c is string => !!c));

  it("lists the 16 CLI-01 command names it counts, and each one is a command", () => {
    const row = rows.find((r) => r.id === "CLI-01")!;
    const names = [...row.text.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!);
    expect(names.length).toBe(Number(/\((\d+)\)/.exec(row.text)?.[1]));
    for (const name of names) expect(commands.has(name), `${name} is not a command`).toBe(true);
  });

  it("names, in CLI rows, only commands and flags the usage text lists", () => {
    const flags = new Set(grammars.flatMap((g) => [...g.flags.keys()]));
    const problems: string[] = [];
    for (const row of rows.filter((r) => r.id.startsWith("CLI-"))) {
      for (const m of row.text.matchAll(/`([^`]+)`/g)) {
        const span = m[1]!;
        for (const flag of span.match(/(?<![\w-])--[a-z][a-z0-9-]*/g) ?? []) {
          if (!flags.has(flag)) problems.push(`${row.id}: ${flag} is in no usage entry`);
        }
        const head = /^(?:docsxai )?([a-z][a-z-]*)(?: <|$)/.exec(span)?.[1];
        if (head && /^(init|capture-auth|baseline|diff|burn|site|pack|drift)$/.test(head)) {
          if (!commands.has(head) && !(head in RETIRED)) problems.push(`${row.id}: ${head}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("names each DOCSX_ variable in an ENV row, and each one is read somewhere", () => {
    const source = [
      ...docsSource("packages/engine/src"),
      ...docsSource("packages/viewer/src"),
      ...docsSource("packages/backend/src"),
      ...docsSource("packages/mcp/src"),
      read("packages/docsxai/bin.mjs"),
      read("packages/docsxai/index.mjs"),
    ].join("\n");
    // Read only by the viewer's opt-in Starlight build test.
    const testOnly = new Set(["DOCSX_STARLIGHT_BUILD"]);
    const problems: string[] = [];
    for (const row of rows.filter((r) => r.id.startsWith("ENV-"))) {
      const name = /`(DOCSX_[A-Z0-9_]+)`/.exec(row.text)?.[1];
      if (!name) problems.push(`${row.id}: no variable named`);
      else if (!testOnly.has(name) && !source.includes(name)) problems.push(`${row.id}: ${name}`);
    }
    expect(problems).toEqual([]);
  });
});

/** The text of every `.ts` file under a repo-relative directory. */
function docsSource(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(path.join(repo, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (e.name.endsWith(".ts")) out.push(read(`${d}/${e.name}`));
    }
  };
  walk(dir);
  return out;
}
