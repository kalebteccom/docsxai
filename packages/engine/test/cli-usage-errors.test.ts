// Usage errors across the CLI stay short: the message, the command's own usage line and a pointer
// to --help, never the whole help text.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

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

describe("CLI usage errors stay short", () => {
  it.each([
    ["run"],
    ["capture-auth"],
    ["calibrate"],
    ["init"],
    ["inspect"],
    ["render"],
    ["burn"],
    ["pack"],
    ["lint"],
    ["flow-tree"],
    ["diagnose"],
    ["style"],
    ["zip"],
    ["baseline"],
    ["diff"],
    ["push"],
    ["pull"],
  ])(
    "%s without a directory names the argument, shows its own usage, no help dump",
    async (cmd) => {
      expect(await main([cmd])).toBe(2);
      expect(err).toMatch(new RegExp(`^${cmd}: missing <`));
      expect(err).toContain(`usage: docsxai ${cmd} `);
      expect(err).not.toContain("Notes:");
      expect(err.split("\n").length).toBeLessThan(12);
      expect(out).toBe("");
    },
  );

  it("an unknown command lists nothing but the pointer", async () => {
    expect(await main(["frobnicate"])).toBe(2);
    expect(err).toBe("unknown command: frobnicate\nrun `docsxai --help` to list the commands\n");
  });

  it("export without a format says what is supported", async () => {
    expect(await main(["export"])).toBe(2);
    expect(err).toContain("export: missing format");
    expect(err).toContain("supported: adf, playwright");
  });
});
