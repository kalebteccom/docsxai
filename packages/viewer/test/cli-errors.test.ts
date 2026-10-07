// `docsxai-viewer` usage errors name the failing command's usage line instead of the whole help, an
// unknown flag or a flag without its value is a usage error (exit 2), and a burn over several flows
// ends with one total line.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewerCli } from "../src/index.js";
import { solidPng } from "./helpers/png.js";

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

describe("viewer usage errors", () => {
  it.each([
    ["build", ["build"], "build: requires <docs-dir> and <out-dir>"],
    ["burn", ["burn"], "burn: requires <workspace>"],
    ["site", ["site"], "site: requires <workspace>"],
  ])("%s without its argument shows only its own usage line", async (cmd, argv, message) => {
    expect(await runViewerCli(argv)).toBe(2);
    const lines = err.trimEnd().split("\n");
    expect(lines[0]).toBe(message);
    expect(lines[1]).toMatch(new RegExp(`^usage: docsxai-viewer ${cmd} `));
    expect(lines.at(-1)).toBe("run `docsxai-viewer` with no arguments for every flag");
    expect(err).not.toContain("Usage:");
    expect(out).toBe("");
  });

  it.each([
    [["burn", "ws", "--nope"], "burn: unknown flag --nope"],
    [["build", "docs", "out", "--nope"], "build: unknown flag --nope"],
    [["site", "ws", "--nope"], "site: unknown flag --nope"],
    [["burn", "ws", "--flow"], "burn: --flow needs a value"],
    [["burn", "ws", "--out", "--flow", "a"], "burn: --out needs a value"],
    [["site", "ws", "--title"], "site: --title needs a value"],
  ])("%j exits 2 with %s", async (argv, message) => {
    expect(await runViewerCli(argv)).toBe(2);
    expect(err.split("\n")[0]).toBe(message);
  });
});

describe("burn over several flows", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-cli-errors-"));
    for (const flow of ["alpha", "beta"]) {
      const dir = path.join(tmp, "docs", flow);
      await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "annotations.json"),
        JSON.stringify({
          schema: "docsxai/annotations@1",
          flow,
          annotations: [
            {
              step: "open",
              selector: "#play",
              bounding_box: { x: 40, y: 50, width: 60, height: 24 },
              copy: "Click Play",
            },
          ],
        }),
      );
      await fs.writeFile(path.join(dir, "screenshots", "open.png"), solidPng(320, 200));
    }
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("ends with the image total, the flow count and where they went", async () => {
    const dest = path.join(tmp, "burn-out");
    expect(await runViewerCli(["burn", tmp, "--out", dest])).toBe(0);
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toBe(`burn: 2 image(s) from 2 flows in ${dest}`);
  });

  it("a single flow keeps its one line", async () => {
    const dest = path.join(tmp, "burn-one");
    expect(await runViewerCli(["burn", tmp, "--flow", "alpha", "--out", dest])).toBe(0);
    expect(out.trimEnd().split("\n")).toEqual([
      `burn: wrote 1 image(s) to ${path.join(dest, "alpha")}`,
    ]);
  });
});
