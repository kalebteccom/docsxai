// An unknown flag is a usage error with a "did you mean" when one is close, and a flag given
// twice is one too. Left alone, a typo such as `--flwo x` runs the command against its defaults.
// A boolean flag never takes the next argument as its value: `run --pause ws` keeps `ws`.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { parseFlags } from "../src/cli-shared.js";

let err = "";
beforeEach(() => {
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const WS = "/some/ws";

describe("an unknown flag exits 2", () => {
  it.each<[string[], string, string, string | undefined]>([
    [["init", WS], "--app-ulr", "init", "--app-url"],
    [["calibrate", WS], "--nmae", "calibrate", "--name"],
    [["inspect", WS], "--selecter", "inspect", "--selector"],
    [["run", WS], "--flwo", "run", "--flow"],
    [["run", WS], "--pasue", "run", "--pause"],
    [["lint", WS], "--formt", "lint", "--format"],
    [["flow-tree", WS], "--formt", "flow-tree", "--format"],
    [["diagnose", WS], "--stpe", "diagnose", "--step"],
    [["style", WS], "--chek", "style", "--check"],
    [["zip", WS], "--ot", "zip", "--out"],
    [["baseline", WS], "--ot", "baseline", "--out"],
    [["diff", WS], "--agianst", "diff", "--against"],
    [["export", "adf", WS], "--tilte", "export adf", "--title"],
    [["export", "playwright", WS], "--flwo", "export playwright", "--flow"],
    [["plugins", "list", WS], "--formt", "plugins list", "--format"],
    [["login"], "--backend-ulr", "login", "--backend-url"],
    [["push", WS], "--auther", "push", "--author"],
    [["pull", WS], "--rve", "pull", "--rev"],
    [["render", WS], "--zzzzzz", "render", undefined],
    [["capture-auth", WS], "--headles", "capture-auth", "--headless"],
    [["doctor", WS], "--ofline", "doctor", "--offline"],
    [["doctor"], "--zzzzzz", "doctor", undefined],
  ])("%j %s", async (cmd, flag, label, near) => {
    expect(await main([...cmd, flag, "x"])).toBe(2);
    expect(err).toContain(`${label}: unknown flag ${flag}`);
    if (near) expect(err).toContain(`did you mean ${near}?`);
    else expect(err).not.toContain("did you mean");
  });
});

describe("a repeated flag exits 2", () => {
  it.each<[string[], string, string]>([
    [["run", WS, "--flow", "a", "--flow", "b"], "run", "--flow"],
    [["run", WS, "--flow=a", "--flow", "b"], "run", "--flow"],
    [["run", WS, "--headed", "--headed"], "run", "--headed"],
    [["lint", WS, "--format", "json", "--format", "text"], "lint", "--format"],
    [["zip", WS, "--out", "a.zip", "--out", "b.zip"], "zip", "--out"],
    [["export", "adf", WS, "--flow", "a", "--flow", "b"], "export adf", "--flow"],
    [["push", WS, "--kind", "run", "--kind", "edit"], "push", "--kind"],
    [["doctor", WS, "--offline", "--offline"], "doctor", "--offline"],
  ])("%j", async (argv, label, flag) => {
    expect(await main(argv)).toBe(2);
    expect(err).toContain(`${label}: ${flag} given more than once`);
  });
});

describe("a boolean flag takes no value", () => {
  it("parseFlags leaves the argument after a boolean flag alone", () => {
    const { positionals, flags } = parseFlags(["--pause", "ws"], ["pause"]);
    expect(positionals).toEqual(["ws"]);
    expect(flags.get("pause")).toBe(true);
  });

  it("run --pause <workspace> reads the workspace, not a flag value", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pause-"));
    try {
      // no flows/ directory: a run that found the workspace fails on that (exit 1), not on usage
      expect(await main(["run", "--pause", dir])).toBe(1);
      expect(err).not.toContain("missing <workspace-dir>");
      expect(err).toContain("flows/");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("a boolean flag given a value exits 2", async () => {
    expect(await main(["run", WS, "--pause=yes"])).toBe(2);
    expect(err).toContain("run: --pause takes no value");
  });

  it("doctor --offline=yes exits 2", async () => {
    expect(await main(["doctor", WS, "--offline=yes"])).toBe(2);
    expect(err).toContain("doctor: --offline takes no value");
  });

  it("doctor --offline <workspace> reads the workspace and runs the checks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-flags-"));
    try {
      const code = await main(["doctor", "--offline", dir]);
      expect([0, 1]).toContain(code);
      expect(err).not.toContain("unknown flag");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("documented flags still pass the flag check", () => {
  it.each<[string[], string]>([
    [["run", WS, "--headed", "--ignore-https-errors", "--concurrency"], "--concurrency"],
    [["init", WS, "--force", "--ignore-https-errors", "--ttl"], "--ttl"],
    [["capture-auth", WS, "--fresh", "--headless", "--ignore-https-errors", "--cdp"], "--cdp"],
    [["zip", WS, "--include-viewer", "--out"], "--out"],
    [["style", WS, "--check", "--format"], "--format"],
  ])("%j reaches the value check", async (argv, bare) => {
    expect(await main(argv)).toBe(2);
    expect(err).toContain(`${bare} needs a value`);
    expect(err).not.toContain("unknown flag");
  });
});
