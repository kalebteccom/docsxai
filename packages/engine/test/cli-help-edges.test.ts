// The help surface at its edges: `help` followed by words, command names that are close to a real
// one or spelled with other dashes and cases, usage lookups for dashed names, and the usage
// error for a label that has no usage entry. The CLI has no "did you mean" hint, so a typo of any
// edit distance prints the same two lines.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { commandUsage, usageError } from "../src/cli-messages.js";
import { USAGE } from "../src/cli-usage.js";

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
  it.each([[[]], [["frobnicate"]], [["run"]], [["run", "--flow", "x"]], [["--help"]]])(
    "prints the whole usage text and exits 0 for help %j",
    async (rest) => {
      expect(await main(["help", ...rest])).toBe(0);
      expect(out).toBe(`${USAGE}\n`);
      expect(err).toBe("");
    },
  );

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
    ["rnu"],
    ["runn"],
    ["burnn"],
    ["flow_tree"],
    ["flowtree"],
    ["Flow-Tree"],
    ["capture_auth"],
    ["capture-auth-"],
    ["-run"],
    ["--run"],
    ["run "],
    [" run"],
    ["RUN"],
    ["constructor"],
    ["__proto__"],
    ["toString"],
    ["hasOwnProperty"],
  ])("exits 2 for %j with the pointer and no suggestion", async (cmd) => {
    expect(await main([cmd])).toBe(2);
    expect(err).toBe(`unknown command: ${cmd}\n${POINTER}`);
    expect(out).toBe("");
  });

  it("exits 2 for an empty command name", async () => {
    expect(await main([""])).toBe(2);
    expect(err).toBe(`unknown command: \n${POINTER}`);
  });

  it("does not look at the arguments after an unknown command", async () => {
    expect(await main(["frobnicate", "--help"])).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("unknown command: frobnicate");
  });
});

describe("commandUsage names", () => {
  const COMMANDS = [
    "init",
    "calibrate",
    "inspect",
    "run",
    "lint",
    "flow-tree",
    "diagnose",
    "doctor",
    "style",
    "zip",
    "baseline",
    "diff",
    "export",
    "plugins",
    "login",
    "push",
    "pull",
    "render",
    "burn",
    "pack",
    "capture-auth",
  ];

  it("has an entry for every command the CLI dispatches, each starting with its own name", () => {
    for (const name of COMMANDS) {
      const entries = commandUsage(name);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(entry).toMatch(new RegExp(`^docsxai ${name} `));
    }
  });

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

  it("has no entry for the retired drift command", () => {
    expect(commandUsage("drift")).toEqual([]);
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
