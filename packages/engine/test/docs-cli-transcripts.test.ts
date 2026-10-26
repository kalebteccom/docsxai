// The CLI reference shows what each command prints, in `text` blocks that start with a `$ docsxai ...`
// line. Counts, paths and names in them are samples; the wording is not. This suite holds every
// output line of those blocks to the line shapes the commands print (captured from a real run of
// each command, anchored to the literal each shape comes from in the CLI source), so a sample that
// keeps an old wording, or a CLI line that changes wording, fails here. A sample line a shape does not
// cover fails too: add the shape when a command gains a line.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

/** One output line a command prints: a pattern for the sample and a literal that must be in the CLI source. */
type Shape = readonly [pattern: RegExp, anchor: string];

const NAME = "[\\w.-]+";

const SHAPES: Record<string, readonly Shape[]> = {
  init: [
    [/^init: workspace(?: \(ephemeral\))? at \S+$/, "init: workspace"],
    [/^ {2}created: .+$/, "  created: "],
    [/^ {2}next: docsxai .+$/, "next: "],
  ],
  "add-flow": [
    [/^add-flow: wrote \S+ {2}\(\d+ steps?\)$/, "add-flow: wrote "],
    [/^add-flow: wrote default \S+$/, "add-flow: wrote default "],
    [/^ {2}next: docsxai run .+$/, "(then: docsxai render"],
  ],
  "capture-auth": [
    [/^capture-auth: launching browser for role ".+" \(.+\).*$/, "capture-auth: launching browser"],
    [
      /^capture-auth: captured \d+ cookie\(s\)(?: \(newest expiry first\):)?$/,
      "capture-auth: captured ",
    ],
    [/^ {4}\S+ {2}@\S+ {2}expires .+$/, "expires "],
    [/^capture-auth: cached \S+ → \S+$/, "capture-auth: cached "],
    [/^ {2}expires \S+ {2}\(from .+; re-run when it lapses\)$/, "; re-run when it lapses)"],
  ],
  inspect: [
    [/^inspect: \S+$/, "inspect: "],
    [/^ {2}title: .*$/, "  title: "],
    [
      /^ {2}\d+ \[data-testid\] element\(s\) \(✓ = visible\), pin these as locators:$/,
      "element(s) (✓ = visible), pin these as locators:",
    ],
    [/^ {4}[✓ ] \[data-testid=".+"\] {2}<\w+> {2}.*$/, '[data-testid="${it.testid}"]'],
    [
      /^ {2}\(--selector '<css>' dumps matching elements' HTML; .+\)$/,
      "(--selector '<css>' dumps matching elements' HTML; ",
    ],
  ],
  run: [
    [new RegExp(`^run: ${NAME}, starting$`), ", starting"],
    [
      new RegExp(`^run: ${NAME}, \\d+ step\\(s\\) executed, \\d+ annotation\\(s\\) written$`),
      "step(s) executed, ",
    ],
    [/^run: \d+ of \d+ flows? ok, outputs in \S+$/, " ok, outputs in "],
    [/^run: \[.+\] step ".+" \(\w+\) failed at(?: .+)?$/, "failed at "],
    [/^run: \d+ of \d+ flows? failed, \d+ ok; outputs in \S+$/, " failed, "],
    [new RegExp(`^ {2}${NAME}: next: docsxai diagnose .+$`), "docsxai diagnose "],
    [
      /^verify-determinism: \d+ runs? of \d+ flows? \(.+\), \d+ artefacts? per run$/,
      "verify-determinism: ",
    ],
    [/^result: (?:IDENTICAL|DIFFERING|HALTED)$/, "result: "],
    [/^first differing artefact: .+ \(run \d+ vs run 1\)$/, "first differing artefact: "],
    [/^ {2}cause: .+$/, "cause: "],
    [/^The workspace output was not touched$/, "The workspace output was not touched"],
  ],
  render: [
    [/^viewer: wrote \d+ page\(s\) to \S+$/, "wrote ${"],
    [/^render: open \S+ {2}\(.+\)?$/, "render: open "],
    [/^render: opened it in your browser$/, "opened it in your browser"],
  ],
  burn: [
    [/^burn: wrote \d+ image\(s\) to \S+$/, "burn: wrote "],
    [/^burn: wrote report to \S+ \(\d+ unplaceable\)$/, "burn: wrote report to "],
  ],
  site: [
    [/^site: emitted \d+ file\(s\) to \S+$/, "site: emitted "],
    [/^site: built \S+ in \d+ms$/, "site: built "],
  ],
  pack: [
    [/^pack: \d+ image\(s\), \d+ written, \d+ removed in \S+$/, "pack: "],
    [/^docsxai drift: \d+ compared, \d+ over threshold \([\d.]+%\)$/, "docsxai drift: "],
    [/^ {2}changed {2}\S+ {2}[\d.]+% {2}region \d+,\d+ \d+x\d+(?: {2}OVER)?$/, "changed  "],
  ],
  lint: [
    [new RegExp(`^flow ${NAME}$`), "flow "],
    [/^ {2}R\d{3} \[(?:info|warning|error)\] .+$/, "R0"],
    [/^ {4}→ .+$/, "→ "],
    [/^\d+ errors?, \d+ warnings?, \d+ info$/, "${infos} info"],
  ],
  "flow-tree": [
    [new RegExp(`^${NAME} {4}\\[\\d+ steps?\\](?: {4}\\{.+\\})?$`), "    [${node.steps} step"],
    [
      new RegExp(`^[│├└─ ]+ ${NAME} {4}\\[\\+\\d+ steps?\\](?: {4}\\{.+\\})?$`),
      "    [+${node.steps} step",
    ],
    [/^\d+ flows?, max chain depth \d+$/, "max chain depth"],
  ],
  diagnose: [
    [/^diagnose: flow=\S+ step=\S+$/, "diagnose: flow="],
    [/^Current step:$/, "Current step:"],
    [/^ {2}(?:action|target|wait_for|success): .+$/, "  action: "],
    [/^Halt artifacts:$/, "Halt artifacts:"],
    [/^ {2}screenshot: \S+$/, "  screenshot: "],
    [/^Live probe \(via \S+\):$/, "Live probe (via "],
    [/^ {2}(?:url|actionable|bbox): .+$/, "  actionable: "],
    [/^Recommendations \(\d+\):$/, "Recommendations ("],
    [/^ {2}\[\w+\] .+$/, "  ["],
    [/^ {4}→ .+$/, "→ "],
  ],
  doctor: [
    [/^(?:ok|fail): [\w]+: .+$/, "fail: doctor: "],
    [/^fail: doctor: \d+ of \d+ checks failed next: .+$/, " checks failed next: "],
  ],
  style: [
    [
      /^style: (?:validated|created) docs\/style\.yaml; rederived docs\/style\.json$/,
      "; rederived ",
    ],
    [/^\d+ jargon leaks?:$/, "jargon leak"],
    [/^ {2}\S+:\d+ {2}\[.+\] {2}.+$/, "  ${"],
  ],
  baseline: [[/^baseline: snapshotted \d+ files? to \S+$/, "baseline: snapshotted "]],
  diff: [
    [/^drift: \S+ → \S+$/, "drift: "],
    [new RegExp(`^flow ${NAME} \\[(?:WARN|FAIL)\\]$`), "flow "],
    [/^ {2}- (?:step|screenshot) .+$/, "  - "],
    [/^totals: .+$/, "totals: "],
  ],
  zip: [[/^zip: wrote \S+ \(\d+ entries, [\d.]+ KB\)$/, "zip: wrote "]],
  export: [[/^export (?:adf|playwright): wrote .+$/, "export "]],
  plugins: [
    [/^plugins sync: wrote \S+ \(\d+ plugin\(s\)\)$/, "plugins sync: wrote "],
    [new RegExp(`^ {2}${NAME} {2}v\\S+ {2}[0-9a-f]+… {2}\\S+$`), "  ${"],
    [/^ {2}(?:apiVersion|capabilities|dependsOn): .+$/, "  apiVersion: "],
    [/^ {2}artifacts \((?:\d+)\):$/, "  artifacts ("],
    [new RegExp(`^ {4}${NAME} {2}\\S+$`), "    "],
    [/^plugins \(\d+ configured, \d+ loaded\):$/, "plugins ("],
    [new RegExp(`^ {0,2}${NAME} {2}(?:loaded|disabled).+$`), "  "],
  ],
  login: [[/^login: ok\. \d+ workspaces? visible at \S+$/, "login: ok. "]],
  push: [
    [
      /^push: screenshots, \d+ blob\(s\) uploaded, \d+ already on the backend$/,
      "blob(s) uploaded, ",
    ],
    [
      /^push: revision \S+ \(\w+, .+\) on \S+, \d+ artifact slots? uploaded, finalized$/,
      ", finalized",
    ],
  ],
  pull: [
    [
      /^pull: revision \S+ \(.+\), wrote \d+ file\(s\) to \S+$/,
      "wrote ${r.filesWritten} file(s) to ",
    ],
  ],
};

/** Output lines that belong to the shell, not to a command: the exit code check. */
const SHELL_LINES = [/^\$ echo \$\?$/, /^\d+$/];

function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name.endsWith(".ts")) out.push(readFileSync(path.join(repo, dir, e.name), "utf8"));
    }
  };
  walk("packages/engine/src");
  walk("packages/viewer/src");
  // The sources write backticks and quotes escaped inside template strings.
  return out.join("\n").replace(/\\`/g, "`");
}

interface Transcript {
  line: number;
  command: string;
  output: Array<{ line: number; text: string }>;
}

/** The `$ docsxai ...` blocks of a markdown text: each `$ ` line with the lines up to the next one. */
function transcriptsIn(md: string): Transcript[] {
  const found: Transcript[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)\n```/g;
  for (const m of md.matchAll(re)) {
    const lang = m[1]!.trim().split(/\s+/)[0]!;
    if (lang !== "" && lang !== "text") continue;
    const first = md.slice(0, m.index).split("\n").length + 1;
    let current: Transcript | null = null;
    for (const [i, text] of m[2]!.split("\n").entries()) {
      const prompt = /^\$ (?:[A-Z_]+=\S+ )*docsxai (\S+)(?: (adf|playwright))?/.exec(text);
      if (prompt) {
        current = { line: first + i, command: prompt[1]!, output: [] };
        found.push(current);
        // `pack --check` prints the pack report under the drift heading.
        if (prompt[1] === "pack" && /\s--check(\s|$)/.test(text)) current.command = "pack";
      } else if (current && text !== "") {
        current.output.push({ line: first + i, text });
      }
    }
  }
  return found;
}

describe("the line shapes", () => {
  const source = sourceText();

  it("each come from a literal in the CLI source", () => {
    const missing: string[] = [];
    for (const [command, shapes] of Object.entries(SHAPES)) {
      for (const [, anchor] of shapes) {
        if (!source.includes(anchor)) missing.push(`${command}: ${JSON.stringify(anchor)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("describe a real lint hint, and the docs quote it as written", () => {
    expect(source).toContain(
      "if duplicates exist, scope with `:visible` or add a `:has-text(...)` qualifier",
    );
  });
});

const PAGES = [
  "website/src/content/docs/reference/cli.md",
  "website/src/content/docs/reference/plugins.md",
];

describe("the transcripts in the CLI and plugins reference", () => {
  const source = sourceText();
  const all = PAGES.map((file) => ({
    file,
    transcripts: transcriptsIn(readFileSync(path.join(repo, file), "utf8")),
  }));

  it("cover at least 20 commands in the CLI reference", () => {
    const cli = all[0]!.transcripts;
    expect(new Set(cli.map((t) => t.command)).size).toBeGreaterThanOrEqual(20);
  });

  for (const { file, transcripts } of all) {
    it(`${file}: print only lines the command prints`, () => {
      const problems: string[] = [];
      for (const t of transcripts) {
        const shapes = SHAPES[t.command];
        if (shapes === undefined) {
          problems.push(`${file}:${t.line}: no line shapes for \`docsxai ${t.command}\``);
          continue;
        }
        const matches = (text: string): boolean =>
          shapes.some(([re]) => re.test(text)) || SHELL_LINES.some((re) => re.test(text));
        let previous = "";
        for (const { line, text } of t.output) {
          if (matches(text)) previous = text;
          // A line the page wrapped by hand continues the one before it.
          else if (previous !== "" && matches(`${previous} ${text.trim()}`))
            previous = `${previous} ${text.trim()}`;
          else
            problems.push(
              `${file}:${line}: \`docsxai ${t.command}\` does not print \`${text.trim()}\``,
            );
          // A hint line quotes the linter's wording.
          const hint = /^ {4}→ (.+)$/.exec(text)?.[1];
          if (hint !== undefined && t.command === "lint" && !source.includes(hint)) {
            problems.push(`${file}:${line}: the lint hint \`${hint}\` is not in the linter`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
