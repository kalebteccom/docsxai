// Contract: the `docsxai` CLI surface (command names, flags, exit codes).
//
// Snapshot: snapshots/cli-usage.json, one normalized line per `Usage:` entry of `docsxai --help`.
// A command or flag added, removed or renamed changes a line, and the test fails until the
// snapshot and docs/public-surface.md say the same thing as the code.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed or renamed command or flag is a breaking change.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.
//
// Also pinned here: the dispatch table in cli.ts names exactly the commands the help lists, and
// the exit-code contract (0 ok, 1 runtime failure, 2 usage error) on paths that touch no browser,
// and the keys of `doctor --format json`.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectJsonSnapshot, readSource } from "../../../../scripts/contract-support.js";
import { main } from "../../src/cli.js";
import { USAGE } from "../../src/cli-usage.js";
import { fullHelp, startScreen } from "../../src/cli-help.js";
import { RETIRED_COMMANDS } from "../../src/cli-retired.js";
import { DOCTOR_JSON_SCHEMA, doctorReport } from "../../src/doctor.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshots = path.join(here, "snapshots");
const cliSource = path.join(here, "..", "..", "src", "cli.ts");

/** The `Usage:` block of the help text as one whitespace-normalized line per entry. */
function usageLines(): string[] {
  const start = USAGE.indexOf("Usage:\n");
  const end = USAGE.indexOf("\n\nNotes:");
  if (start < 0 || end < 0) throw new Error("help text lost its Usage: / Notes: structure");
  const entries: string[] = [];
  for (const line of USAGE.slice(start + "Usage:\n".length, end).split("\n")) {
    if (/^ {2}docsxai /.test(line)) entries.push(line.trim());
    else if (entries.length > 0) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  return entries.map((e) => e.replace(/\s+/g, " "));
}

let out = "";
let err = "";
beforeEach(() => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI usage contract", () => {
  it("matches the checked-in usage snapshot", () => {
    expectJsonSnapshot(path.join(snapshots, "cli-usage.json"), usageLines());
  });

  it("dispatches exactly the commands the help lists", () => {
    const labels = [...readSource(cliSource).matchAll(/^ {4}case "([^"]+)":/gm)].map((m) => m[1]!);
    const helpAliases = ["--help", "-h", "help"];
    const dispatched = labels.filter((l) => !helpAliases.includes(l)).sort();
    const listed = [
      ...new Set(
        usageLines()
          .map((line) => line.split(" ")[1]!)
          .filter((word) => !word.startsWith("-")),
      ),
    ].sort();
    expect(dispatched).toEqual(listed);
    for (const alias of helpAliases) expect(labels).toContain(alias);
  });
});

describe("retired commands", () => {
  it("are not listed in the help and have no dispatch case of their own", () => {
    const labels = [...readSource(cliSource).matchAll(/^ {4}case "([^"]+)":/gm)].map((m) => m[1]!);
    for (const name of Object.keys(RETIRED_COMMANDS)) {
      expect(labels).not.toContain(name);
      expect(usageLines().map((line) => line.split(" ")[1])).not.toContain(name);
    }
  });

  it("each names the release that retired it and rewrites to a listed command", () => {
    const listed = new Set(usageLines().map((line) => line.split(" ")[1]));
    for (const entry of Object.values(RETIRED_COMMANDS)) {
      expect(entry.since).toMatch(/^\d+\.\d+\.\d+$/);
      expect(listed.has(entry.rewrite(["x"])[0])).toBe(true);
    }
  });
});

describe("CLI exit-code contract", () => {
  it("prints the help and exits 0 with no command or with --help", async () => {
    expect(await main([])).toBe(0);
    expect(out).toBe(startScreen());
    out = "";
    expect(await main(["--help"])).toBe(0);
    expect(out).toBe(fullHelp());
    expect(out).toContain(USAGE.split("\n").slice(1).join("\n").trimEnd());
  });

  it("exits 2 on an unknown command and names it on stderr", async () => {
    expect(await main(["no-such-command"])).toBe(2);
    expect(err).toMatch(/unknown command: no-such-command/);
  });

  const needsWorkspace = [
    "init",
    "add-flow",
    "inspect",
    "run",
    "render",
    "burn",
    "site",
    "pack",
    "capture-auth",
    "lint",
    "flow-tree",
    "diagnose",
    "style",
    "zip",
    "baseline",
    "diff",
    "push",
    "pull",
    "login",
  ];
  it.each(needsWorkspace)("exits 2 when `%s` gets no arguments", async (command) => {
    expect(await main([command])).toBe(2);
  });

  it("exits 2 on an unknown `export` format", async () => {
    expect(await main(["export", "no-such-format"])).toBe(2);
    expect(err).toMatch(/supported: adf, playwright/);
  });

  it("exits 2 on an unknown `burn` flag", async () => {
    expect(await main(["burn", "some-workspace", "--no-such-flag"])).toBe(2);
    expect(err).toMatch(/unknown flag --no-such-flag/);
  });
});

describe("doctor --format json contract", () => {
  it("keeps its schema id and its keys, in order", () => {
    const report = doctorReport([{ name: "node", ok: false, detail: "v20", fix: "upgrade Node" }], {
      version: "0.0.0",
      next: "docsxai run .",
    });
    expect(DOCTOR_JSON_SCHEMA).toBe("docsxai/doctor@1");
    expect(Object.keys(report)).toEqual(["schema", "version", "ok", "checks", "next"]);
    expect(Object.keys(report.checks[0]!)).toEqual(["name", "ok", "info", "detail", "next"]);
  });
});
