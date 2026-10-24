// The help surface at its edges: `help` followed by words, command names that are close to a real
// one or spelled with other dashes and cases, usage lookups for dashed names, and the usage
// error for a label that has no usage entry. A typo within edit distance 2 of a command also gets a
// "did you mean" line between the unknown-command line and the pointer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { commandUsage, usageError } from "../src/cli-messages.js";
import { fullHelp } from "../src/cli-help.js";

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

const POINTER = "run `docsxai --help` to list the commands\n";

describe("help followed by words", () => {
  it("prints the whole help and exits 0 for a bare help", async () => {
    expect(await main(["help"])).toBe(0);
    expect(out).toBe(fullHelp());
    expect(err).toBe("");
  });

  it("prints only that command's usage and exits 0 when words follow the command name", async () => {
    expect(await main(["help", "run", "--flow", "x"])).toBe(0);
    expect(out).toContain("usage:   docsxai run ");
    expect(out).not.toContain("docsxai init ");
    expect(err).toBe("");
  });

  it("exits 2 for help about a name that is not a command", async () => {
    expect(await main(["help", "frobnicate"])).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("unknown command: frobnicate");
  });

  it("treats -h and --help the same way", async () => {
    expect(await main(["-h"])).toBe(0);
    const short = out;
    out = "";
    expect(await main(["--help"])).toBe(0);
    expect(out).toBe(short);
  });
});

describe("a command name that is not one", () => {
  it.each([
    ["rn"],
    ["flow_tree"],
    ["Flow-Tree"],
    ["capture-auth-"],
    ["-run"],
    ["--run"],
    ["run "],
    ["constructor"],
    ["__proto__"],
  ])("exits 2 for %j and ends with the pointer", async (cmd) => {
    expect(await main([cmd])).toBe(2);
    expect(err.startsWith(`unknown command: ${cmd}\n`)).toBe(true);
    expect(err.endsWith(POINTER)).toBe(true);
    expect(out).toBe("");
  });

  it("exits 2 for an empty command name", async () => {
    expect(await main([""])).toBe(2);
    expect(err.startsWith("unknown command: \n")).toBe(true);
    expect(err.endsWith(POINTER)).toBe(true);
  });

  it("does not look at the arguments after an unknown command", async () => {
    expect(await main(["frobnicate", "--help"])).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("unknown command: frobnicate");
  });
});

describe("commandUsage names", () => {
  it("matches a dashed name whole, and not by its prefix or in another case", () => {
    expect(commandUsage("flow-tree")).toHaveLength(1);
    expect(commandUsage("capture-auth")).toHaveLength(1);
    for (const near of ["flow", "capture", "flow-tre", "flow_tree", "Flow-Tree", "RUN", ""]) {
      expect(commandUsage(near)).toEqual([]);
    }
  });

  it("reads only the first word of a label, so a flag or a subcommand follows freely", () => {
    expect(commandUsage("run --verify-determinism")).toEqual(commandUsage("run"));
    expect(commandUsage("plugins list")).toEqual(commandUsage("plugins"));
    expect(commandUsage("export adf")).toHaveLength(2);
  });
});

describe("usageError for a label without a usage entry", () => {
  it("prints the message and the pointer, with no usage line", () => {
    expect(usageError("frobnicate", "missing <thing>")).toBe(2);
    expect(err).toBe(
      "frobnicate: missing <thing>\nrun `docsxai --help` for every flag and an example\n",
    );
  });
});
