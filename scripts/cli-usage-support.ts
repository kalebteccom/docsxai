// Shared reader for the `Usage:` block of `docsxai --help`, used by the two suites that check
// markdown against it: packages/engine/test/docs-cli-mentions.test.ts (README and docs site) and
// packages/plugin/test/cli-usage.test.ts (plugin commands and skills). Test-only: nothing here is
// published or imported by `src/`.

import { readdirSync } from "node:fs";
import * as path from "node:path";

/**
 * The `docsxai ...` entries of the `Usage:` block in a usage text, or in the source of the module
 * that holds it. One string per entry, continuation lines joined, whitespace collapsed, optional
 * brackets kept (`docsxai run <workspace-dir> [--flow <name>]`).
 */
export function usageEntries(text: string): string[] {
  const start = text.indexOf("Usage:\n");
  const end = text.indexOf("\n\nNotes:");
  if (start === -1) throw new Error("no `Usage:` block in the usage text");
  if (end <= start) throw new Error("no `Notes:` block after the `Usage:` block");
  const entries: string[] = [];
  for (const line of text.slice(start + "Usage:\n".length, end).split("\n")) {
    if (/^ {2}docsxai /.test(line)) entries.push(line.trim());
    else if (entries.length > 0) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  return entries.map((e) => e.replace(/\s+/g, " "));
}

/** Every `--flag` in a text. A flag glued to a word or to more dashes does not count. */
export function flagsIn(text: string): string[] {
  return text.match(/(?<![\w-])--[a-z][a-z0-9-]*/g) ?? [];
}

/** Whether `flag` is one of the flags `text` lists, so `--run` never matches `--runs`. */
export function hasFlag(text: string, flag: string): boolean {
  return flagsIn(text).includes(flag);
}

/** The entries keyed by command: `run`, `diff`, `export adf`, `export playwright`, `--help`. */
export function usageByCommand(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of usageEntries(text)) {
    const head = /^docsxai (\S+)(?: (adf|playwright)\b)?/.exec(entry)!;
    const key = head[1] === "export" && head[2] ? `export ${head[2]}` : head[1]!;
    entries.set(key, (entries.get(key) ?? "") + entry + "\n");
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Usage grammar and markdown extraction, for the suites that check whole invocations
// (packages/engine/test/docs-cli-usage.test.ts and packages/viewer/test/docs-cli-usage.test.ts).
// ---------------------------------------------------------------------------

/** One flag of a usage entry: required when it sits outside brackets, `value` when it takes one. */
export interface UsageFlag {
  required: boolean;
  /** The value token (`<url>`, `text|md|json`), or null for a flag that takes none. */
  value: string | null;
}

/** A usage entry cut into its parts. */
export interface UsageGrammar {
  /** The entry as written, whitespace collapsed. */
  entry: string;
  /** Leading command words: `["run"]`, `["export", "adf"]`, `[]` for `docsxai --help`. */
  command: string[];
  /** Positional slots in order, with whether each is required. */
  positionals: Array<{ required: boolean; token: string }>;
  flags: Map<string, UsageFlag>;
}

/** Cut one usage entry (`docsxai run <workspace-dir> [--flow <name>]`, any binary name) apart. */
export function parseUsageEntry(entry: string): UsageGrammar {
  const collapsed = entry.replace(/\s+/g, " ").trim();
  const rest = collapsed.replace(/^\S+\s*/, "");
  const parts: Array<{ optional: boolean; words: string[] }> = [];
  for (const m of rest.matchAll(/\[([^\]]*)\](?:\.\.\.)?|(\S+)/g)) {
    if (m[1] !== undefined)
      parts.push({ optional: true, words: m[1].split(/\s+/).filter(Boolean) });
    else parts.push({ optional: false, words: [m[2]!] });
  }
  const command: string[] = [];
  let i = 0;
  while (i < parts.length && !parts[i]!.optional && /^[a-z][a-z-]*$/.test(parts[i]!.words[0]!)) {
    command.push(parts[i]!.words[0]!);
    i += 1;
  }
  const positionals: UsageGrammar["positionals"] = [];
  const flags = new Map<string, UsageFlag>();
  for (const part of parts.slice(i)) {
    const { words } = part;
    for (let k = 0; k < words.length; k += 1) {
      const w = words[k]!;
      if (w.startsWith("--")) {
        const next = words[k + 1];
        const value = next !== undefined && !next.startsWith("--") ? next : null;
        flags.set(w, { required: !part.optional, value });
        if (value !== null) k += 1;
      } else {
        positionals.push({ required: !part.optional, token: w });
      }
    }
  }
  return { entry: collapsed, command, positionals, flags };
}

/** Text a docs example may put where a real value goes: `<name>`, `$WORKSPACE`, `~/x`, `./dir`, `...`. */
const PLACEHOLDER = /^(?:<[^>]*>|\$[\w{(]|\.{3}|…)/;

/** Shell syntax that ends the command in a docs line: a comment, a pipe, a redirect, a chain. */
function stripShellTail(command: string): string {
  return command
    .replace(/\s{2,}\S.*$/, "")
    .replace(/\s+#\s.*$/, "")
    .replace(/\s*(?:&&|\|\||;)\s.*$/, "")
    .replace(/\s+\|\s.*$/, "")
    .replace(/\s+\d?>>?\s*\S+.*$/, "")
    .trim();
}

function shellWords(command: string): string[] {
  return [...command.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) =>
    m[0].replace(/^(["'])(.*)\1$/, "$2"),
  );
}

/**
 * What is wrong with one invocation (the text after the binary name) against the usage entries of
 * that binary. Empty when some entry fits. Checks the command words, that every flag exists and takes a
 * value only when the usage gives it one, enumerated values (`text|md|json`), that required flags
 * and positionals are there, and that no positional is extra. `strict: false` skips the two arity
 * checks, for a code span that names a command with only the flags of interest.
 */
export function invocationProblems(
  grammars: UsageGrammar[],
  invocation: string,
  opts: { strict: boolean },
): string[] {
  const words = shellWords(stripShellTail(invocation));
  const first = words[0] ?? "";
  if (first === "") return [];
  const second = words[1] ?? "";
  const candidates = grammars.filter(
    (g) =>
      g.command.length > 0 &&
      g.command[0] === first &&
      (g.command[1] === undefined || g.command[1] === second),
  );
  if (candidates.length === 0) {
    const flagEntry = grammars.some((g) => g.command.length === 0 && g.flags.has(first));
    return flagEntry || /^-[a-z]$/.test(first)
      ? []
      : [`"${first}" is not a command in the usage text`];
  }
  const all: string[][] = [];
  for (const g of candidates) {
    const problems: string[] = [];
    const args = words.slice(g.command.length);
    const used = new Set<string>();
    const positionals: string[] = [];
    for (let k = 0; k < args.length; k += 1) {
      const arg = args[k]!;
      if (!arg.startsWith("--")) {
        positionals.push(arg);
        continue;
      }
      const [name = "", inline] = arg.split("=", 2) as [string, string | undefined];
      if (name === "--help") {
        used.add(name);
        continue;
      }
      const flag = g.flags.get(name);
      if (flag === undefined) {
        problems.push(`${name} is not a flag of \`${g.entry}\``);
        continue;
      }
      used.add(name);
      let value: string | undefined = inline;
      if (flag.value === null) {
        if (inline !== undefined) problems.push(`${name} takes no value`);
        continue;
      }
      if (inline === undefined) {
        const next = args[k + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          k += 1;
        }
      }
      if (value === undefined) {
        if (opts.strict) problems.push(`${name} needs a value`);
        continue;
      }
      if (/^[a-z0-9.-]+(?:\|[a-z0-9.-]+)+$/i.test(flag.value) && !PLACEHOLDER.test(value)) {
        if (!flag.value.split("|").includes(value)) {
          problems.push(`${name} ${value}: the usage allows ${flag.value}`);
        }
      }
    }
    if (opts.strict) {
      for (const [name, flag] of g.flags) {
        if (flag.required && !used.has(name)) problems.push(`${name} is required`);
      }
      const required = g.positionals.filter((p) => p.required).length;
      if (positionals.length < required) {
        problems.push(
          `missing ${g.positionals
            .filter((p) => p.required)
            .slice(positionals.length)
            .map((p) => p.token)
            .join(" ")}`,
        );
      }
      if (positionals.length > g.positionals.length) {
        problems.push(`extra argument ${positionals.slice(g.positionals.length).join(" ")}`);
      }
    }
    for (const [index, token] of positionals.entries()) {
      const slot = g.positionals[index]?.token;
      if (slot !== undefined && /^<[a-z]+(?:\|[a-z]+)+>$/.test(slot) && !PLACEHOLDER.test(token)) {
        if (!slot.slice(1, -1).split("|").includes(token)) {
          problems.push(`${token}: the usage allows ${slot}`);
        }
      }
    }
    if (problems.length === 0) return [];
    all.push(problems);
  }
  // Report the entry the invocation is closest to: fewest unknown flags, then fewest problems.
  const unknown = (p: string[]): number => p.filter((x) => x.includes("is not a flag")).length;
  return all.sort((a, b) => unknown(a) - unknown(b) || a.length - b.length)[0]!;
}

/**
 * The markdown that shows commands to a reader, as repo-relative paths: the README, every package
 * README, the plugin commands and skills, `docs/*.md`, the docs site pages and the examples. The
 * internal notes under `docs/ai-context` and `docs/archive` are left out.
 */
export function docsMarkdownFiles(repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(rel);
      } else if (/\.mdx?$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const dir of ["packages", "website/src/content/docs", "examples"]) walk(dir);
  for (const entry of readdirSync(path.join(repo, "docs"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) out.push(`docs/${entry.name}`);
  }
  out.push("README.md");
  return out.filter((f) => !f.includes("/test/")).sort();
}

const SKIPPED_DIRS = new Set(["node_modules", "dist", "test", ".astro"]);

/** One `<bin> ...` command found in markdown. */
export interface DocInvocation {
  /** 1-based line of the mention. */
  line: number;
  /** The binary named: `docsxai` or `docsxai-viewer`. */
  bin: string;
  /** What follows the binary name, continuation lines joined. */
  command: string;
  /** A fenced shell line (whole invocation) or an inline code span (a reference to part of one). */
  kind: "block" | "span";
}

const SHELL_FENCE_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "text"]);
const LEADING_ENV = /^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const BIN_LINE = /^(docsxai(?:-viewer)?)\s+(\S.*)$/;

/**
 * Every `docsxai ...` and `docsxai-viewer ...` command in the code spans and shell fences of a markdown
 * text. A fence can opt out with `not-docsxai` after its language. In a fence with `$ ` prompt lines
 * only those lines are commands. A line that ends in a backslash joins the next one.
 */
export function docInvocations(markdown: string): DocInvocation[] {
  const found: DocInvocation[] = [];
  const lines = markdown.split("\n");
  let fence: { marker: string; read: boolean } | null = null;
  let body: Array<{ line: number; text: string }> = [];
  const flush = (): void => {
    const prompted = body.filter((b) => /^\s*\$\s/.test(b.text));
    const pool = prompted.length > 0 ? prompted : body;
    for (const [index, { line, text }] of pool.entries()) {
      let joined = text
        .trim()
        .replace(/^\$\s+/, "")
        .replace(LEADING_ENV, "");
      let next = index;
      while (joined.endsWith("\\") && next + 1 < pool.length) {
        next += 1;
        joined = `${joined.slice(0, -1).trimEnd()} ${pool[next]!.text.trim()}`;
      }
      const m = BIN_LINE.exec(joined);
      if (m) found.push({ line, bin: m[1]!, command: m[2]!.trim(), kind: "block" });
    }
    body = [];
  };
  for (const [index, raw] of lines.entries()) {
    const edge = /^\s*(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fence !== null) {
      if (edge && edge[1]!.startsWith(fence.marker) && edge[2]!.trim() === "") {
        if (fence.read) flush();
        else body = [];
        fence = null;
      } else {
        body.push({ line: index + 1, text: raw });
      }
      continue;
    }
    if (edge) {
      const info = edge[2]!.trim();
      const lang = (info.split(/\s+/)[0] ?? "").toLowerCase();
      fence = {
        marker: edge[1]!,
        read: SHELL_FENCE_LANGS.has(lang) && !/\bnot-docsxai\b/.test(info),
      };
      continue;
    }
    for (const span of raw.matchAll(/`([^`]+)`/g)) {
      const m = BIN_LINE.exec(span[1]!.trim());
      if (m) found.push({ line: index + 1, bin: m[1]!, command: m[2]!.trim(), kind: "span" });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}
