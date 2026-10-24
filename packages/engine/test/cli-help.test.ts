// First-run help: the no-argument screen, `help <command>`, `<command> --help`, typo suggestions,
// exit codes and the width of the usage lines.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { USAGE } from "../src/cli-usage.js";
import { commandNames, editDistance, suggestCommand } from "../src/cli-help.js";
import { usageByCommand } from "../../../scripts/cli-usage-support.js";

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

describe("no-argument screen", () => {
  it("leads with init --example, run and render --open, then groups the commands", async () => {
    expect(await main([])).toBe(0);
    const lines = out.split("\n");
    expect(lines.slice(2, 7)).toEqual([
      "Start here (an example flow on example.com):",
      "  1. docsxai init <workspace-dir> --example",
      "  2. docsxai run <workspace-dir>",
      "  3. docsxai render <workspace-dir> --open",
      "Your own app: docsxai init <workspace-dir> --app-url <url>, then calibrate a flow.",
    ]);
    const titles = ["Getting started", "Run and verify", "Publish", "Packs", "Auth", "Plugins"];
    for (const title of [...titles, "Diagnostics"]) expect(out).toContain(`\n${title}:\n`);
    expect(out).toContain("docsxai --help");
  });

  it("lists exactly the commands the usage text lists", () => {
    const listed = [...usageByCommand(USAGE).keys()]
      .filter((k) => !k.startsWith("-"))
      .map((k) => k.split(" ")[0]!);
    expect([...new Set(listed)].sort()).toEqual(commandNames().sort());
  });

  it("--help starts with the same first steps and still ends with the full usage", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out.indexOf("Start here:")).toBeLessThan(out.indexOf("\nUsage:\n"));
    expect(out).toContain(USAGE.slice(USAGE.indexOf("Usage:\n")));
  });
});

describe("per-command help", () => {
  it.each([[["help", "run"]], [["run", "--help"]], [["run", "ws", "-h"]]])("%j", async (argv) => {
    expect(await main(argv)).toBe(0);
    expect(out).toContain("usage:   docsxai run <workspace-dir> [--flow <name>]");
    expect(out).toContain("docsxai run <workspace-dir> --verify-determinism");
    expect(out.match(/^example: /gm)).toHaveLength(1);
    expect(out).not.toContain("docsxai lint");
    expect(out).not.toContain("Notes:");
    expect(err).toBe("");
  });

  it("has a usage line and one example for every command", async () => {
    for (const name of commandNames()) {
      out = "";
      expect(await main(["help", name]), name).toBe(0);
      expect(out, name).toContain(`usage:   docsxai ${name} `.trimEnd());
      expect(out.match(/^example: docsxai /gm), name).toHaveLength(1);
    }
  });

  it("help for a name that is not a command exits 2 with a suggestion", async () => {
    expect(await main(["help", "rn"])).toBe(2);
    expect(err).toContain("did you mean `docsxai run`?");
  });
});

describe("unknown command", () => {
  it("suggests the closest command and points to --help, exit 2", async () => {
    expect(await main(["rn"])).toBe(2);
    expect(err).toBe(
      "unknown command: rn\ndid you mean `docsxai run`?\nrun `docsxai --help` to list the commands\n",
    );
    expect(out).toBe("");
  });

  it("suggests within edit distance 2 only", () => {
    expect(suggestCommand("calibrat")).toBe("calibrate");
    expect(suggestCommand("flowtree")).toBe("flow-tree");
    expect(suggestCommand("lnt")).toBe("lint");
    expect(suggestCommand("frobnicate")).toBeUndefined();
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("usage text", () => {
  it("keeps every line of the Usage block under 100 columns", () => {
    const block = USAGE.slice(USAGE.indexOf("Usage:\n"), USAGE.indexOf("\n\nNotes:"));
    for (const line of block.split("\n")) expect(line.length, line).toBeLessThan(100);
  });
});
