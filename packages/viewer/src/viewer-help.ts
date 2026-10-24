// `docsxai-viewer <command> --help`: one command's usage lines and flag notes, cut from the full
// help text. Mirrors the engine's `docsxai help <command>`; the two packages share no import, so
// the small shape lives here too. Leaf module: index.ts hands it the help text.

/** True when argv asks for help: `--help` or `-h` anywhere. */
export const asksHelp = (argv: readonly string[]): boolean =>
  argv.some((a) => a === "--help" || a === "-h");

/** The `docsxai-viewer <command>` lines of `usage`, trimmed, in order. */
export function usageLines(usage: string, command: string): string[] {
  return usage
    .split("\n")
    .filter((l) => l.startsWith(`  docsxai-viewer ${command} `))
    .map((l) => l.trim());
}

/** The flag notes of `command` in `usage`: the blocks that open `  <command>: ` or `  <command> --`. */
function notes(usage: string, command: string): string[] {
  return usage
    .split("\n\n")
    .filter((b) => b.startsWith(`  ${command}: `) || b.startsWith(`  ${command} --`))
    .map((b) => b.trimEnd());
}

/** What `docsxai-viewer <command> --help` prints: the usage lines, then the command's flag notes. */
export function commandHelp(usage: string, command: string): string {
  const lines = usageLines(usage, command).map(
    (l, i) => `${i === 0 ? "usage:   " : "         "}${l}`,
  );
  return [lines.join("\n"), ...notes(usage, command)].join("\n\n") + "\n";
}
