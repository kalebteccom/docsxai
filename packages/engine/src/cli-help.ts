// Help screens and typo suggestions for the `docsxai` CLI. Builds on the USAGE text and the
// per-command usage lookup in cli-messages.ts; cli.ts calls it for `help`, `--help` and an unknown
// command. Leaf module: no command handler imports from here.

import { USAGE } from "./cli-usage.js";
import { commandUsage } from "./cli-messages.js";
import { RETIRED_COMMANDS } from "./cli-retired.js";
import { findRetired } from "./deprecation.js";

/** The first steps for a new user, printed before any long list. */
export const START_HERE = `Start here (an example flow on example.com):
  1. docsxai init <workspace-dir> --example
  2. docsxai run <workspace-dir>
  3. docsxai render <workspace-dir> --open
Your own app: docsxai init <workspace-dir> --app-url <url>, then docsxai add-flow.`;

/** Commands by purpose, each with a one-line description. Every dispatched command appears once. */
export const COMMAND_GROUPS: ReadonlyArray<{
  title: string;
  commands: ReadonlyArray<readonly [name: string, description: string]>;
}> = [
  {
    title: "Getting started",
    commands: [
      ["init", "scaffold a workspace for your app"],
      ["add-flow", "add a flow from a flow-file (formerly calibrate)"],
      ["inspect", "list the page's test ids to pin locators"],
    ],
  },
  {
    title: "Run and verify",
    commands: [
      ["run", "capture screenshots and annotations (--verify-determinism to check)"],
      ["lint", "static checks on the flow files"],
      ["flow-tree", "print the extends graph"],
      ["style", "create or check docs/style.yaml"],
      ["baseline", "snapshot the doc pack as the diff baseline"],
      ["diff", "compare the workspace with a baseline"],
    ],
  },
  {
    title: "Publish",
    commands: [
      ["render", "build the static viewer"],
      ["burn", "bake annotations into copies of the screenshots"],
      ["site", "write a Starlight docs site from the doc pack"],
      ["zip", "package the doc pack as one archive"],
      ["export", "write the flows as ADF or Playwright specs"],
      ["push", "upload the doc pack as a backend revision"],
      ["pull", "fetch a backend revision into the workspace"],
    ],
  },
  { title: "Packs", commands: [["pack", "build or check a screenshot pack for a docs site"]] },
  {
    title: "Auth",
    commands: [
      ["capture-auth", "log in once and cache the session"],
      ["login", "check a backend token or sign in with OAuth"],
    ],
  },
  { title: "Plugins", commands: [["plugins", "list, inspect or sync a workspace's plugins"]] },
  {
    title: "Diagnostics",
    commands: [
      ["doctor", "check the environment and the workspace"],
      ["diagnose", "explain a halted step and suggest a fix"],
    ],
  },
];

/** Every command name in {@link COMMAND_GROUPS}, in listing order. */
export function commandNames(): string[] {
  return COMMAND_GROUPS.flatMap((g) => g.commands.map(([name]) => name));
}

/** The grouped command list, one line each. */
export function groupedCommands(): string {
  const lines: string[] = [];
  for (const g of COMMAND_GROUPS) {
    lines.push(`${g.title}:`);
    for (const [name, description] of g.commands) {
      lines.push(`  ${name.padEnd(13)}${description}`);
    }
  }
  return lines.join("\n");
}

/** What `docsxai` prints with no argument: the first steps, then the commands by purpose. */
export function startScreen(): string {
  return [
    "docsxai: deterministic execution CLI",
    "",
    START_HERE,
    "",
    groupedCommands(),
    "",
    "docsxai help <command>   usage and an example for one command",
    "docsxai --help           every command and flag, with notes",
    "",
  ].join("\n");
}

/** What `docsxai --help` prints: the first steps and the groups, then the full usage text. */
export function fullHelp(): string {
  const [title, ...rest] = USAGE.split("\n");
  return [title, "", START_HERE, "", groupedCommands(), ...rest, ""].join("\n");
}

/** Levenshtein distance between two strings. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The name in `names` closest to `input` within edit distance 2, or `undefined`. The first listed wins a tie. */
export function nearestName(input: string, names: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const name of names) {
    const d = editDistance(input.toLowerCase(), name);
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}

/** The command closest to `input` within edit distance 2, or `undefined`. */
export function suggestCommand(input: string): string | undefined {
  return nearestName(input, commandNames());
}

/** The usage lines and one example of `command`, or `undefined` for a name that is not a command. */
export function commandHelp(command: string): string | undefined {
  const usage = commandUsage(command);
  if (usage.length === 0) return undefined;
  const lines = usage.map((l, i) => `${i === 0 ? "usage:   " : "         "}${l}`);
  const examples = USAGE.slice(USAGE.indexOf("\nExamples:\n") + "\nExamples:\n".length)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.split(" ")[1] === command);
  if (examples[0]) lines.push(`example: ${examples[0]}`);
  lines.push("run `docsxai --help` for every command and the notes");
  return lines.join("\n") + "\n";
}

/** Print the unknown-command message, with a suggestion when one is close. Returns exit code 2. */
export function unknownCommand(cmd: string): number {
  const near = suggestCommand(cmd);
  const hint = near ? `did you mean \`docsxai ${near}\`?\n` : "";
  process.stderr.write(
    `unknown command: ${cmd}\n${hint}run \`docsxai --help\` to list the commands\n`,
  );
  return 2;
}

/**
 * Handle `help [<command>]` and `<command> --help|-h`. Returns the exit code, or `undefined` when
 * argv is an ordinary command line. `doctor` keeps its own help, so it is left to its handler.
 */
export function tryHelp(cmd: string | undefined, rest: string[]): number | undefined {
  if (cmd === undefined) {
    process.stdout.write(startScreen());
    return 0;
  }
  if (cmd === "--help" || cmd === "-h" || (cmd === "help" && rest.length === 0)) {
    process.stdout.write(fullHelp());
    return 0;
  }
  const asksHelp = rest.some((a) => a === "--help" || a === "-h");
  const target = cmd === "help" ? rest[0] : asksHelp ? cmd : undefined;
  if (target === undefined || (cmd !== "help" && target === "doctor")) return undefined;
  // `help calibrate` answers with the help of the command a retired name now runs.
  const retired = findRetired(RETIRED_COMMANDS, target);
  const text = commandHelp(retired ? retired.rewrite([])[0]! : target);
  if (text === undefined) return unknownCommand(target);
  process.stdout.write(text);
  return 0;
}
