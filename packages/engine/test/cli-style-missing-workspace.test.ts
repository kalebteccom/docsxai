// `style` on a path that is not a directory reports it; it does not create the tree.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let tmp = "";
let err = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-style-missing-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("style with a workspace path that is not a directory", () => {
  it("exits 1 and creates nothing for a missing path", async () => {
    const missing = path.join(tmp, "typo", "ws");
    expect(await main(["style", missing])).toBe(1);
    expect(err).toContain(`style: ${missing} is not a directory`);
    expect(err).toContain("next:");
    await expect(fs.access(path.join(tmp, "typo"))).rejects.toThrow();
  });

  it("exits 1 for a file", async () => {
    const file = path.join(tmp, "file.txt");
    await fs.writeFile(file, "x", "utf8");
    expect(await main(["style", file])).toBe(1);
    expect(err).toContain("is not a directory");
  });

  it("still scaffolds style.yaml in an existing directory", async () => {
    expect(await main(["style", tmp])).toBe(0);
    await fs.access(path.join(tmp, "docs", "style.yaml"));
  });
});
