// `zip --out` and `export --flow` failures name the cause and the path or flag, and give one
// `next:` line. A bug-report "unexpected error" is for bugs, and these are not.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-zipexp-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "ws");
  expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1"])).toBe(0);
  err = "";
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("zip --out", () => {
  it("a directory names it and asks for a .zip file path", async () => {
    const dir = path.join(tmp, "dir");
    await fs.mkdir(dir);
    expect(await main(["zip", ws, "--out", dir])).toBe(1);
    expect(err).toContain(`zip: ${dir} is a directory, but --out needs a .zip file path`);
    expect(err).toContain(`next: docsxai zip ${ws} --out ${path.join(dir, "ws.zip")}`);
    expect(err).not.toContain("unexpected error");
  });

  it("a file in the path names the file and the move", async () => {
    const file = path.join(tmp, "plain");
    await fs.writeFile(file, "x");
    expect(await main(["zip", ws, "--out", path.join(file, "x.zip")])).toBe(1);
    expect(err).toContain(`zip: ${file} is a file, but docsxai needs a directory there`);
    expect(err).toContain(`next: mv ${file} ${file}.bak, then rerun the command`);
    expect(err).not.toContain("unexpected error");
  });
});

describe("export --flow with a name that is not there", () => {
  it.each(["adf", "playwright"])("%s says it once and points at flow-tree", async (format) => {
    expect(await main(["export", format, ws, "--flow", "nope"])).toBe(1);
    expect(err).toContain(`export ${format}: no flow named "nope" in ${path.join(ws, "flows")}`);
    expect(err).not.toContain(`export ${format}: export ${format}:`);
    expect(err).toContain(`next: docsxai flow-tree ${ws}`);
  });
});
