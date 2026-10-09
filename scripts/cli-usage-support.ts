// Shared reader for the `Usage:` block of `docsxai --help`, used by the two suites that check
// markdown against it: packages/engine/test/docs-cli-mentions.test.ts (README and docs site) and
// packages/plugin/test/cli-usage.test.ts (plugin commands and skills). Test-only: nothing here is
// published or imported by `src/`.

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
