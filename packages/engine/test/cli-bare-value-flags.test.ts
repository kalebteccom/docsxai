// A flag that takes a value, given with nothing after it, is a usage error. Left alone it falls
// back to its default and the command runs against something the operator did not ask for.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

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

describe("a bare value flag exits 2", () => {
  it.each<[string[], string, string]>([
    [["init"], "--app-url", "init"],
    [["init"], "--auth", "init"],
    [["init"], "--role", "init"],
    [["init"], "--ttl", "init"],
    [["init"], "--capture-trigger", "init"],
    [["init"], "--auth-cookie", "init"],
    [["add-flow"], "--name", "add-flow"],
    [["inspect"], "--url", "inspect"],
    [["inspect"], "--selector", "inspect"],
    [["inspect"], "--cdp", "inspect"],
    [["inspect"], "--wait", "inspect"],
    [["inspect"], "--wait-for", "inspect"],
    [["inspect"], "--role", "inspect"],
    [["lint"], "--flow", "lint"],
    [["lint"], "--format", "lint"],
    [["flow-tree"], "--format", "flow-tree"],
    [["diagnose"], "--format", "diagnose"],
    [["diagnose"], "--cdp", "diagnose"],
    [["diagnose"], "--variant", "diagnose"],
    [["style"], "--format", "style"],
    [["zip"], "--out", "zip"],
    [["export", "adf"], "--mode", "export adf"],
    [["export", "adf"], "--flow", "export adf"],
    [["export", "adf"], "--title", "export adf"],
    [["export", "adf"], "--out", "export adf"],
    [["export", "playwright"], "--flow", "export playwright"],
    [["export", "playwright"], "--out", "export playwright"],
    [["capture-auth"], "--base-url", "capture-auth"],
    [["capture-auth"], "--role", "capture-auth"],
    [["capture-auth"], "--auth-cookie", "capture-auth"],
    [["capture-auth"], "--cdp", "capture-auth"],
    [["push"], "--kind", "push"],
    [["push"], "--author", "push"],
    [["pull"], "--rev", "pull"],
  ])("%j %s", async (cmd, flag, label) => {
    expect(await main([...cmd, WS, flag])).toBe(2);
    expect(err).toContain(`${label}: ${flag} needs a value`);
  });

  it("plugins list --format", async () => {
    expect(await main(["plugins", "list", WS, "--format"])).toBe(2);
    expect(err).toContain("plugins list: --format needs a value");
  });

  it("add-flow --from", async () => {
    expect(await main(["add-flow", WS, "--from"])).toBe(2);
    expect(err).toContain("--from");
  });
});

describe("an empty value for a run flag exits 2", () => {
  it.each(["--flow", "--variant", "--stop-after", "--start-from", "--cdp", "--concurrency"])(
    "%s",
    async (flag) => {
      expect(await main(["run", WS, flag, ""])).toBe(2);
      expect(err).toMatch(new RegExp(`run: ${flag} (needs a value|must be)`));
    },
  );
});

describe("values that name nothing usable", () => {
  it("inspect --wait takes whole milliseconds", async () => {
    expect(await main(["inspect", WS, "--wait", "soon"])).toBe(2);
    expect(err).toContain('inspect: --wait must be a whole number of milliseconds (got "soon")');
  });

  it("init --persist takes only tmp", async () => {
    expect(await main(["init", WS, "--persist", "disk"])).toBe(2);
    expect(err).toContain('init: --persist must be "tmp" (got "disk")');
  });
});
