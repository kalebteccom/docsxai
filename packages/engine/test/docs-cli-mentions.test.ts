// The README and the user-facing pages of the docs site show `docsxai <command> [--flag]` in code
// spans and in shell blocks. This suite pulls every one of them out and checks that the command and
// each flag appear in the usage text `docsxai --help` prints, so a renamed or dropped flag fails here
// instead of staying in the docs. Only code spans and fenced blocks of a shell kind (no language,
// sh, bash, shell, zsh, console, text) are read; blocks of any other language are skipped, and a
// shell block can opt out with `not-docsxai` after its language (```sh not-docsxai). In a block with
// `$ ` prompt lines only those lines are commands, so a transcript's output is never read as one.
// The CI recipes have their own suite (ci-examples.test.ts).

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { USAGE } from "../src/cli-usage.js";
import { flagsIn, hasFlag, usageEntries } from "../../../scripts/cli-usage-support.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const docsDir = "website/src/content/docs";

/** The README, the getting-started and reference pages, and the determinism guide. */
function checkedFiles(): string[] {
  const pages = ["getting-started", "reference"].flatMap((dir) =>
    readdirSync(path.join(repo, docsDir, dir))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => `${docsDir}/${dir}/${f}`),
  );
  return ["README.md", ...pages, `${docsDir}/guides/determinism-and-drift.md`];
}

/** Fewest mentions a file must yield: a guard against an extractor that quietly finds nothing. */
const MINIMUM_MENTIONS: Record<string, number> = {
  "README.md": 6,
  [`${docsDir}/getting-started/quickstart.md`]: 5,
  [`${docsDir}/reference/cli.md`]: 40,
};

/** Flags a command takes that its usage line does not list. `doctor --help` is checked below. */
const EXTRA_FLAGS: Record<string, string[]> = { doctor: ["--help"] };

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

/** The `docsxai <command> …` entries of the Usage block, keyed by command (`export adf`, `run`, …). */
function usageByCommand(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of usageEntries(text)) {
    const head = /^docsxai (\S+)(?: (adf|playwright)\b)?/.exec(entry)!;
    const key = head[1] === "export" && head[2] ? `export ${head[2]}` : head[1]!;
    entries.set(key, (entries.get(key) ?? "") + entry + "\n");
  }
  return entries;
}

const usage = usageByCommand(USAGE);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface Mention {
  /** 1-based line of the mention. */
  line: number;
  /** What follows `docsxai `. */
  command: string;
}

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "text"]);
/** Leading `NAME=value ` assignments of a shell line. */
const ENV_PREFIX = /^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const DOCSXAI_LINE = /^docsxai\s+(\S.*)$/;

function commandOf(line: string): string | null {
  const bare = line
    .trim()
    .replace(/^\$\s+/, "")
    .replace(ENV_PREFIX, "");
  return DOCSXAI_LINE.exec(bare)?.[1]?.trim() ?? null;
}

/** The commands in the lines of one shell block: the `$ ` lines when it has any, else every line. */
function blockCommands(body: Array<{ line: number; text: string }>): Mention[] {
  const prompted = body.filter((b) => /^\s*\$\s/.test(b.text));
  const out: Mention[] = [];
  for (const { line, text } of prompted.length > 0 ? prompted : body) {
    const command = commandOf(text);
    if (command !== null) out.push({ line, command });
  }
  return out;
}

/** Every `docsxai …` command in the code spans and shell blocks of a markdown text, in line order. */
function mentionsIn(markdown: string): Mention[] {
  const found: Mention[] = [];
  let fence: { marker: string; read: boolean; body: Array<{ line: number; text: string }> } | null =
    null;
  for (const [index, raw] of markdown.split("\n").entries()) {
    const line = index + 1;
    const edge = /^\s*(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fence !== null) {
      if (edge && edge[1]!.startsWith(fence.marker) && edge[2]!.trim() === "") {
        if (fence.read) found.push(...blockCommands(fence.body));
        fence = null;
      } else {
        fence.body.push({ line, text: raw });
      }
      continue;
    }
    if (edge) {
      const info = edge[2]!.trim();
      const lang = (info.split(/\s+/)[0] ?? "").toLowerCase();
      fence = {
        marker: edge[1]!,
        read: SHELL_LANGS.has(lang) && !/\bnot-docsxai\b/.test(info),
        body: [],
      };
      continue;
    }
    for (const span of raw.matchAll(/`([^`]+)`/g)) {
      const command = DOCSXAI_LINE.exec(span[1]!.trim())?.[1]?.trim();
      if (command !== undefined) found.push({ line, command });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

/** What is wrong with one mention: an unknown command, or a flag its usage entry does not list. */
function problemsWith(command: string): string[] {
  const [first = "", second = ""] = command.split(/\s+/);
  const key = first === "export" ? `export ${second}` : first;
  const entry = usage.get(key);
  if (entry === undefined) {
    return [`\`docsxai ${command}\` uses "${key}", which \`docsxai --help\` does not list`];
  }
  return flagsIn(command)
    .filter((flag) => !hasFlag(entry, flag) && !(EXTRA_FLAGS[key] ?? []).includes(flag))
    .map(
      (flag) =>
        `\`docsxai ${command}\` uses ${flag}, which the usage text does not list for "${key}"`,
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the extractor", () => {
  const sample = [
    "Run `docsxai run --flow a` first, then `docsxai-viewer build` and `docsxai/annotations@1`.",
    "",
    "```sh",
    "docsxai lint ws",
    "DOCSX_TOKEN=$CI_TOKEN docsxai login --backend-url http://h",
    "```",
    "",
    "```",
    "$ docsxai run ws --flow a",
    "docsxai doctor — environment & workspace health",
    "```",
    "",
    "```json",
    '{ "cmd": "docsxai frobnicate" }',
    "```",
    "",
    "```sh not-docsxai",
    "docsxai frobnicate ws",
    "```",
    "",
    "After the fences, `docsxai diff --fail-on warn` is read again.",
  ].join("\n");

  it("reads code spans and shell lines, and nothing else", () => {
    expect(mentionsIn(sample)).toEqual([
      { line: 1, command: "run --flow a" },
      { line: 4, command: "lint ws" },
      { line: 5, command: "login --backend-url http://h" },
      { line: 9, command: "run ws --flow a" },
      { line: 21, command: "diff --fail-on warn" },
    ]);
  });

  it("keeps the longer fence open until a matching close", () => {
    const md = ["````sh", "```", "docsxai lint ws", "````", "`docsxai zip ws`"].join("\n");
    expect(mentionsIn(md).map((m) => m.command)).toEqual(["lint ws", "zip ws"]);
  });
});

describe("the checker", () => {
  it("accepts the commands and flags the usage text lists", () => {
    for (const ok of [
      "--help",
      "run ws --verify-determinism --runs 3 --format md",
      "run ws --flow a --stop-after b --pause",
      "pack ws --check --against dir --threshold 1",
      "pack ws --no-optimise --generated-for abc",
      "burn ws --report r.json --no-connector-outline",
      "export adf ws --mode single --title t",
      "export playwright ws --out dir",
      "plugins list ws --format json",
      "login --backend-url http://h --oauth ws",
      "doctor ws",
      "doctor --help",
    ]) {
      expect(problemsWith(ok), ok).toEqual([]);
    }
  });

  it("rejects a command or flag the usage text does not list", () => {
    expect(problemsWith("frobnicate ws")[0]).toMatch(/uses "frobnicate", which .* does not list/);
    expect(problemsWith("drift ws")[0]).toMatch(/uses "drift"/);
    expect(problemsWith("export csv ws")[0]).toMatch(/uses "export csv"/);
    expect(problemsWith("run ws --verify-everything")[0]).toMatch(/uses --verify-everything/);
    expect(problemsWith("lint ws --check")[0]).toMatch(/uses --check, .* for "lint"/);
    expect(problemsWith("zip ws --help")[0]).toMatch(/uses --help/);
  });

  it("does not take a longer flag for a shorter one", () => {
    expect(problemsWith("diff ws --fail")[0]).toMatch(/uses --fail,/);
    expect(problemsWith("run ws --runs")).toEqual([]);
  });

  it("holds for `doctor --help`, the one flag the usage text leaves out", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    expect(await main(["doctor", "--help"])).toBe(0);
    expect(out).toContain("usage: docsxai doctor");
  });
});

describe("README.md and the docs site pages", () => {
  const files = checkedFiles();

  it("cover the README, the quickstart and the CLI reference", () => {
    for (const must of Object.keys(MINIMUM_MENTIONS)) expect(files).toContain(must);
  });

  for (const file of files) {
    it(`${file}: every docsxai command and flag is in \`docsxai --help\``, () => {
      const found = mentionsIn(readFileSync(path.join(repo, file), "utf8"));
      expect(found.length, `${file}: no docsxai command found`).toBeGreaterThanOrEqual(
        MINIMUM_MENTIONS[file] ?? 0,
      );
      const problems = found.flatMap((m) =>
        problemsWith(m.command).map((p) => `${file}:${m.line}: ${p}`),
      );
      expect(problems).toEqual([]);
    });
  }
});
