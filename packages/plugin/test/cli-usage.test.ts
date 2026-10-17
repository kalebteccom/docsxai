// The plugin's command and skill prose against the CLI's help text. Every `docsxai <subcommand>`
// the markdown documents, and every flag it passes, must appear in the `Usage:` block of
// `docsxai --help` (packages/engine/src/cli-usage.ts), so a flag renamed or removed in the engine
// fails here instead of in an agent's shell. Dependency-free: the help text is read as source.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  flagsIn as sharedFlagsIn,
  hasFlag as sharedHasFlag,
  usageEntries as usageEntriesOf,
} from "../../../scripts/cli-usage-support.js";
import { listCommands, listSkills, pluginDir } from "../src/index.js";

const repoRoot = path.resolve(pluginDir, "..", "..");
const vendoredSkillFile = path.join(repoRoot, "packages", "skill", "skill", "docsxai", "SKILL.md");

/** The `Usage:` entries of the help text, read from the source, with the optional brackets dropped. */
async function usageEntries(): Promise<string[]> {
  const src = await fs.readFile(
    path.join(repoRoot, "packages", "engine", "src", "cli-usage.ts"),
    "utf8",
  );
  return usageEntriesOf(src).map((e) => e.replace(/[[\]]/g, ""));
}

const subcommandOf = (entry: string): string => entry.split(" ")[1] ?? "";
/** Flags of other tools that the prose mentions in passing (Chrome's own, for the CDP walkthrough). */
const FOREIGN_FLAGS = new Set(["--remote-debugging-port"]);
const flagsIn = (text: string): string[] =>
  sharedFlagsIn(text).filter((f) => !FOREIGN_FLAGS.has(f));
const hasFlag = (entries: string[], flag: string): boolean =>
  entries.some((e) => sharedHasFlag(e, flag));

/** Every code span in the markdown: each non-empty line of a fenced block, and each inline span. */
function codeSpans(markdown: string): string[] {
  const spans: string[] = [];
  const prose = markdown.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, block: string) => {
    for (const line of block.split("\n")) if (line.trim()) spans.push(line.trim());
    return "\n";
  });
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) spans.push(m[1]!.trim());
  return spans;
}

/**
 * What is wrong with one code span, as messages. A span that starts with `docsxai <word>` (or with a
 * subcommand name) must name a real subcommand and pass real flags. A span that starts with a flag
 * is checked against `owner`'s entries when given, else against the whole help text. Spans about
 * other tools (`npx`, `browxai`, `pnpm`) are not checked.
 */
function problemsInSpan(span: string, entries: string[], owner?: string): string[] {
  const subcommands = new Set(entries.map(subcommandOf).filter((s) => !s.startsWith("-")));
  const first = span.split(/\s+/)[0]!;
  const prefixed = /^docsxai\s+([a-z][a-z-]*)(?=\s|$)/.exec(span);
  const sub = prefixed ? prefixed[1]! : subcommands.has(first) ? first : undefined;
  if (sub !== undefined) {
    if (!subcommands.has(sub)) return [`\`${span}\`: \`docsxai ${sub}\` is not a CLI subcommand`];
    const own = entries.filter((e) => subcommandOf(e) === sub);
    return flagsIn(span)
      .filter((f) => !hasFlag(own, f))
      .map((f) => `\`${span}\`: ${f} is not a flag of \`docsxai ${sub}\``);
  }
  if (!first.startsWith("--")) return [];
  const pool = owner ? entries.filter((e) => subcommandOf(e) === owner) : entries;
  return flagsIn(span)
    .filter((f) => !hasFlag(pool, f))
    .map(
      (f) => `\`${span}\`: ${f} is not a flag of ${owner ? `\`docsxai ${owner}\`` : "any command"}`,
    );
}

function frontmatterValue(text: string, key: string): string | undefined {
  return new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text.split(/\n---/)[0]!)?.[1]?.trim();
}

const read = (...parts: string[]): Promise<string> => fs.readFile(path.join(...parts), "utf8");

type Doc = [file: string, text: string];

/** The plugin's markdown: command files, then skills, the vendored skill and the README. */
async function markdownDocs(): Promise<{ commands: Doc[]; others: Doc[]; all: Doc[] }> {
  const commands: Doc[] = [];
  for (const cmd of await listCommands()) {
    commands.push([`commands/${cmd}.md`, await read(pluginDir, "commands", `${cmd}.md`)]);
  }
  const others: Doc[] = [];
  for (const skill of await listSkills()) {
    others.push([`skills/${skill}/SKILL.md`, await read(pluginDir, "skills", skill, "SKILL.md")]);
  }
  others.push(["packages/skill/skill/docsxai/SKILL.md", await read(vendoredSkillFile)]);
  others.push(["README.md", await read(pluginDir, "README.md")]);
  return { commands, others, all: [...commands, ...others] };
}

describe("commands against the CLI help text", () => {
  it("every command wraps a real subcommand and its argument-hint is a subset of the usage lines", async () => {
    const entries = await usageEntries();
    for (const cmd of await listCommands()) {
      const hint = frontmatterValue(
        await read(pluginDir, "commands", `${cmd}.md`),
        "argument-hint",
      );
      expect(hint, `commands/${cmd}.md argument-hint`).toBeTruthy();
      const own = entries.filter((e) => subcommandOf(e) === cmd);
      expect(own.length, `commands/${cmd}.md wraps \`docsxai ${cmd}\``).toBeGreaterThan(0);
      const afterCmd = own.map((e) => e.split(" ").slice(2));
      const tokens = hint!.replace(/[[\]]/g, "").split(/\s+/);
      const flagAt = tokens.findIndex((t) => t.startsWith("--"));
      const lead = flagAt === -1 ? tokens : tokens.slice(0, flagAt);

      const prefixOfSome = (words: string[]): boolean =>
        afterCmd.some((rest) => words.every((w, i) => rest[i] === w));
      const alternation = /^<(\w+(?:\|\w+)+)>$/.exec(lead[0] ?? "");
      const alternatives = alternation ? alternation[1]!.split("|") : [];
      const leadOk =
        lead.length === 0 ||
        prefixOfSome(lead) ||
        (alternatives.length > 0 && alternatives.every((a) => prefixOfSome([a, ...lead.slice(1)])));
      expect(leadOk, `commands/${cmd}.md: \`${lead.join(" ")}\` is not how \`${cmd}\` starts`).toBe(
        true,
      );

      const usageText = own.join(" ");
      for (let i = flagAt; flagAt !== -1 && i < tokens.length; i++) {
        const flag = tokens[i]!;
        if (!flag.startsWith("--")) continue;
        const value = tokens[i + 1];
        const withValue = value !== undefined && !value.startsWith("--") ? ` ${value}` : "";
        const pattern = new RegExp(`(^| )${flag}${withValue.replace(/[|]/g, "\\|")}( |$)`);
        expect(usageText, `commands/${cmd}.md hint \`${flag}${withValue}\``).toMatch(pattern);
      }
    }
  });

  it("every `docsxai …` example in a command names real subcommands and flags", async () => {
    const entries = await usageEntries();
    const problems: string[] = [];
    for (const cmd of await listCommands()) {
      const text = await read(pluginDir, "commands", `${cmd}.md`);
      for (const span of codeSpans(text)) {
        for (const p of problemsInSpan(span, entries, cmd)) problems.push(`${cmd}.md ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("passes $ARGUMENTS as quoted words, never bare in a code block", async () => {
    for (const cmd of await listCommands()) {
      const text = await read(pluginDir, "commands", `${cmd}.md`);
      const body = text.replace(/^---[\s\S]*?\n---\n/, "");
      expect(body, `commands/${cmd}.md`).toContain("$ARGUMENTS");
      expect(body, `commands/${cmd}.md`).toMatch(/single-quoted/);
      for (const block of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        expect(block[1], `commands/${cmd}.md code block`).not.toContain("$ARGUMENTS");
      }
    }
  });
});

describe("skills against the CLI help text", () => {
  it("every `docsxai …` example names real subcommands and flags", async () => {
    const entries = await usageEntries();
    const problems: string[] = [];
    for (const [file, text] of (await markdownDocs()).others) {
      for (const span of codeSpans(text)) {
        for (const p of problemsInSpan(span, entries)) problems.push(`${file} ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the skill name in the frontmatter is the directory name, matching /docsxai:<name>", async () => {
    for (const skill of await listSkills()) {
      const text = await read(pluginDir, "skills", skill, "SKILL.md");
      expect(frontmatterValue(text, "name"), `skills/${skill}/SKILL.md`).toBe(skill);
    }
    expect(frontmatterValue(await read(vendoredSkillFile), "name")).toBe("docsxai");
  });
});

describe("terminology and advertised surface", () => {
  it("says workspace, as the CLI does, never project directory", async () => {
    for (const [file, text] of (await markdownDocs()).all) {
      expect(text, file).not.toMatch(/project-dir|project directory/i);
    }
  });

  it("does not advertise the repo-only publisher plugins or the MCP server as installable", async () => {
    for (const [file, text] of (await markdownDocs()).all) {
      expect(text, file).not.toMatch(/sharepoint|guru|notion|gitbook/i);
      for (const paragraph of text.split(/\n\s*\n/)) {
        if (/@docsxai\/mcp|@docsxai\/plugin-confluence|confluence:push/.test(paragraph)) {
          expect(paragraph, `${file}: names a repo-only package`).toMatch(/repo-only/);
        }
      }
    }
  });

  it("lists every command and skill in the plugin README", async () => {
    const readme = await read(pluginDir, "README.md");
    for (const cmd of await listCommands()) expect(readme).toContain(`/docsxai:${cmd}`);
    for (const skill of await listSkills()) expect(readme).toContain(`\`${skill}\``);
  });
});
