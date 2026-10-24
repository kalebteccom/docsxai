// `docsxai add-flow` and its retired name `calibrate`: the new name works and is the one the help
// lists, the old name prints one deprecation line on stderr and runs add-flow with the same
// arguments and exit codes. No browser: add-flow only validates and writes a flow-file.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { commandNames, START_HERE } from "../src/cli-help.js";
import { resetDeprecationWarnings } from "../src/deprecation.js";

const WARNING = "docsxai: calibrate is now add-flow; the old name still works\n";

let out = "";
let err = "";
let tmp = "";

beforeEach(async () => {
  resetDeprecationWarnings();
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-add-flow-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const FLOW = `name: open-reports
steps:
  - id: open
    action: { goto: "/reports" }
`;

async function guide(): Promise<string> {
  const file = path.join(tmp, "open-reports.flow.yaml");
  await fs.writeFile(file, FLOW);
  return file;
}

describe("docsxai add-flow", () => {
  it("writes the flow-file and names itself in its output", async () => {
    const ws = path.join(tmp, "ws");
    expect(await main(["add-flow", ws, "--from", await guide()])).toBe(0);
    expect(out).toMatch(/^add-flow: wrote .*open-reports\.flow\.yaml {2}\(1 steps\)\n/);
    expect(err).toBe("");
    await fs.access(path.join(ws, "flows", "open-reports.flow.yaml"));
  });

  it("keeps the usage errors and exit codes", async () => {
    expect(await main(["add-flow"])).toBe(2);
    expect(err).toMatch(/^add-flow: missing <workspace-dir>\nusage: docsxai add-flow /);
    err = "";
    expect(await main(["add-flow", "ws"])).toBe(2);
    expect(err).toMatch(/--from <flow.md\|.yaml> is required/);
    err = "";
    expect(await main(["add-flow", "ws", "--from", path.join(tmp, "none.yaml")])).toBe(1);
    expect(err).toMatch(/^add-flow: cannot read /);
  });

  it("rejects an unknown flag as before", async () => {
    expect(await main(["add-flow", "ws", "--nmae", "x"])).toBe(2);
    expect(err).toMatch(/unknown flag --nmae/);
    expect(err).toMatch(/--name/);
  });

  it("is listed in the help and the start screen, and calibrate is not", async () => {
    expect(commandNames()).toContain("add-flow");
    expect(commandNames()).not.toContain("calibrate");
    expect(START_HERE).toContain("docsxai add-flow <workspace-dir> --from <flow.yaml>");
    expect(await main(["--help"])).toBe(0);
    expect(out).toContain("docsxai add-flow <workspace-dir> --from <flow.md|.yaml> [--name <flow>]");
    expect(out).not.toMatch(/docsxai calibrate /);
  });

  it("prints its own help", async () => {
    expect(await main(["help", "add-flow"])).toBe(0);
    expect(out).toMatch(/^usage: {3}docsxai add-flow /);
  });
});

describe("the retired calibrate command", () => {
  it("prints one deprecation line and runs add-flow with the same arguments", async () => {
    const ws = path.join(tmp, "ws");
    expect(await main(["calibrate", ws, "--from", await guide()])).toBe(0);
    expect(err).toBe(WARNING);
    expect(out).toMatch(/^add-flow: wrote .*open-reports\.flow\.yaml/);
    await fs.access(path.join(ws, "flows", "open-reports.flow.yaml"));
  });

  it("keeps the exit codes of add-flow", async () => {
    expect(await main(["calibrate"])).toBe(2);
    expect(err.startsWith(WARNING)).toBe(true);
    expect(err).toMatch(/add-flow: missing <workspace-dir>/);
    expect(await main(["calibrate", "ws", "--from", path.join(tmp, "none.yaml")])).toBe(1);
  });

  it("keeps the unknown-flag handling", async () => {
    expect(await main(["calibrate", "ws", "--nmae", "x"])).toBe(2);
    expect(err.startsWith(WARNING)).toBe(true);
    expect(err.slice(WARNING.length)).toMatch(/unknown flag --nmae/);
  });

  it("warns once per process", async () => {
    await main(["calibrate"]);
    await main(["calibrate"]);
    expect(err.split(WARNING).length - 1).toBe(1);
  });

  it("answers help for the old name with add-flow's help", async () => {
    expect(await main(["help", "calibrate"])).toBe(0);
    expect(out).toMatch(/^usage: {3}docsxai add-flow /);
    out = "";
    expect(await main(["calibrate", "--help"])).toBe(0);
    expect(out).toMatch(/^usage: {3}docsxai add-flow /);
  });
});
