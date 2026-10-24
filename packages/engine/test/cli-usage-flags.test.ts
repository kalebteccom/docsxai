// The flags `docsxai --help` and `docsxai help <command>` list for each command are the flags its
// handler reads. Three checks per command: the usage text equals a pinned table, `help <command>`
// shows the same flags, and the handler source reads each one (and no flag the usage omits).
//
// The handlers parse into a permissive map, so there is no accepted set to import. The source
// check reads each handler file for `flags.get/has("x")`, `str("x")` and exact `"--x"` literals;
// it matches per file, so a flag moved between commands that share a file needs the table edited.
// `--help` is left out: `tryHelp` answers it for every command before a handler runs.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandHelp } from "../src/cli-help.js";
import { USAGE } from "../src/cli-usage.js";
import { doctorHelp } from "../src/doctor.js";
import { flagsIn, usageByCommand } from "../../../scripts/cli-usage-support.js";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Command (as `usageByCommand` keys it) → the flags its handler reads, and the files that read them. */
const COMMANDS: Record<string, { flags: string[]; files: string[] }> = {
  init: {
    flags: [
      "app-url",
      "auth",
      "role",
      "ttl",
      "capture-trigger",
      "auth-cookie",
      "ignore-https-errors",
      "persist",
      "force",
    ],
    files: ["cli-commands-session.ts"],
  },
  calibrate: { flags: ["from", "name"], files: ["cli-commands-session.ts"] },
  inspect: {
    flags: ["url", "selector", "cdp", "wait", "wait-for", "headed", "ignore-https-errors", "role"],
    files: ["cli-commands-authoring.ts"],
  },
  run: {
    flags: [
      "flow",
      "base-url",
      "headed",
      "ignore-https-errors",
      "stop-after",
      "start-from",
      "variant",
      "cdp",
      "pause",
      "concurrency",
      "device-scale-factor",
      "verify-determinism",
      "runs",
      "format",
    ],
    files: ["cli-commands-session.ts", "cli-verify.ts"],
  },
  lint: { flags: ["flow", "format"], files: ["cli-commands-authoring.ts"] },
  "flow-tree": { flags: ["format"], files: ["cli-commands-authoring.ts"] },
  diagnose: {
    flags: ["flow", "step", "variant", "cdp", "format"],
    files: ["cli-commands-authoring.ts"],
  },
  doctor: { flags: ["offline"], files: ["doctor.ts"] },
  style: { flags: ["check", "format"], files: ["cli-commands-style.ts"] },
  zip: { flags: ["out", "include-viewer"], files: ["cli-commands-docpack.ts"] },
  baseline: { flags: ["out"], files: ["cli-commands-docpack.ts"] },
  diff: { flags: ["against", "format", "fail-on"], files: ["cli-commands-docpack.ts"] },
  "export adf": { flags: ["flow", "mode", "title", "out"], files: ["cli-commands-docpack.ts"] },
  "export playwright": { flags: ["flow", "out"], files: ["cli-commands-docpack.ts"] },
  plugins: { flags: ["format"], files: ["plugins-cli.ts"] },
  login: { flags: ["backend-url", "oauth"], files: ["cli-commands-backend.ts"] },
  push: { flags: ["kind", "author"], files: ["cli-commands-backend.ts"] },
  pull: { flags: ["rev"], files: ["cli-commands-backend.ts"] },
  render: { flags: [], files: ["cli-commands-docpack.ts"] },
  burn: {
    flags: ["flow", "out", "report", "no-connector-outline"],
    files: ["cli-commands-docpack.ts"],
  },
  pack: {
    flags: [
      "from-raw",
      "out",
      "public-prefix",
      "no-optimise",
      "generated-for",
      "check",
      "against",
      "threshold",
    ],
    files: ["cli-commands-pack.ts"],
  },
  "capture-auth": {
    flags: ["base-url", "role", "auth-cookie", "cdp", "fresh", "headless", "ignore-https-errors"],
    files: ["cli-commands-auth.ts"],
  },
};

const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const bare = (flags: string[]): string[] => flags.map((f) => f.slice(2));

/** Flags of the usage entries keyed `command` (`pack` holds its build and `--check` lines). */
function usageFlags(command: string): string[] {
  return sorted(bare(flagsIn(usageByCommand(USAGE).get(command) ?? "")));
}

/** Every flag a handler file reads. */
function readFlags(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(path.join(src, file), "utf8");
    for (const m of text.matchAll(/\b(?:flags\.(?:get|has)|str)\(\s*"([a-z][a-z-]*)"\s*\)/g)) {
      found.push(m[1]!);
    }
    for (const m of text.matchAll(/"--([a-z][a-z-]*)"/g)) found.push(m[1]!);
  }
  return sorted(found.filter((f) => f !== "help"));
}

describe("CLI flags: usage text, help and handlers agree", () => {
  it("covers every command in the usage text", () => {
    const listed = [...usageByCommand(USAGE).keys()].filter((k) => !k.startsWith("-"));
    expect(sorted(listed)).toEqual(sorted(Object.keys(COMMANDS)));
  });

  it.each(Object.entries(COMMANDS))("%s: usage lists the pinned flags", (command, spec) => {
    expect(usageFlags(command)).toEqual(sorted(spec.flags));
  });

  it.each(Object.keys(COMMANDS).filter((c) => !c.startsWith("export ")))(
    "%s: help shows the same flags",
    (command) => {
      const shown = sorted(bare(flagsIn(commandHelp(command)!)).filter((f) => f !== "help"));
      expect(shown).toEqual(sorted(COMMANDS[command]!.flags));
    },
  );

  it("export: help shows the flags of both formats", () => {
    const both = [...COMMANDS["export adf"]!.flags, ...COMMANDS["export playwright"]!.flags];
    const shown = sorted(bare(flagsIn(commandHelp("export")!)).filter((f) => f !== "help"));
    expect(shown).toEqual(sorted(both));
  });

  it("doctor --help names --offline", () => {
    expect(flagsIn(doctorHelp())).toContain("--offline");
  });

  it.each(Object.entries(COMMANDS))("%s: the handler reads each documented flag", (_c, spec) => {
    const read = readFlags(spec.files);
    for (const flag of spec.flags) expect(read).toContain(flag);
  });

  it.each([...new Set(Object.values(COMMANDS).map((s) => s.files.join(" ")))])(
    "%s: the handlers read no flag the usage omits",
    (fileList) => {
      const files = fileList.split(" ");
      const documented = Object.values(COMMANDS)
        .filter((s) => s.files.some((f) => files.includes(f)))
        .flatMap((s) => s.flags);
      expect(readFlags(files).filter((f) => !documented.includes(f))).toEqual([]);
    },
  );
});
