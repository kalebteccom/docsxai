// Writers go through a temp file and a rename, so a write that dies partway leaves the old file
// intact: an interrupted `run` or `pull` never leaves a truncated annotations.json behind.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomic } from "../src/atomic-write.js";
import { writeDocPack } from "../src/doc-pack-io.js";

let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-atomic-"));
  await fs.writeFile(path.join(dir, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

/** Make every write land half of its bytes and then fail, like a process killed mid-write. */
function failWritesHalfway(): void {
  const real = fs.writeFile.bind(fs) as (...args: unknown[]) => Promise<void>;
  vi.spyOn(fs, "writeFile").mockImplementation((async (
    p: unknown,
    data: unknown,
    ...rest: unknown[]
  ) => {
    await real(p, Buffer.from(data as string).subarray(0, 3), ...rest);
    throw new Error("disk full");
  }) as never);
}

describe("writeFileAtomic", () => {
  it("writes the bytes and leaves no temp file in the directory", async () => {
    const target = path.join(dir, "a.json");
    await writeFileAtomic(target, '{"a":1}\n', "utf8");
    expect(await fs.readFile(target, "utf8")).toBe('{"a":1}\n');
    expect(await fs.readdir(dir)).toEqual([".docsxai.json", "a.json"]);
  });

  it("keeps the old content when the write dies partway, and removes the temp file", async () => {
    const target = path.join(dir, "a.json");
    await fs.writeFile(target, '{"old":true}\n', "utf8");
    failWritesHalfway();
    await expect(writeFileAtomic(target, '{"new":true}\n', "utf8")).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await fs.readFile(target, "utf8")).toBe('{"old":true}\n');
    expect(await fs.readdir(dir)).toEqual([".docsxai.json", "a.json"]);
  });

  it.skipIf(process.platform === "win32")("keeps the mode of an existing file", async () => {
    const target = path.join(dir, "a.json");
    await fs.writeFile(target, "old", { mode: 0o600 });
    await fs.chmod(target, 0o600);
    await writeFileAtomic(target, "new", "utf8");
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")(
    "writes through a symlink and keeps the link",
    async () => {
      const real = path.join(dir, "real.json");
      const link = path.join(dir, "link.json");
      await fs.writeFile(real, "old", "utf8");
      await fs.symlink(real, link);
      await writeFileAtomic(link, "new", "utf8");
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(real, "utf8")).toBe("new");
    },
  );
});

describe("writeDocPack", () => {
  it("keeps the existing annotations.json when a pulled write dies partway", async () => {
    const abs = path.join(dir, "docs", "tour", "annotations.json");
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, '{"old":true}\n', "utf8");
    failWritesHalfway();
    await expect(
      writeDocPack(dir, {
        annotations: {
          schema: "docsxai/annotations-bundle@1",
          files: { "tour/annotations.json": { fresh: true } },
        },
      }),
    ).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await fs.readFile(abs, "utf8")).toBe('{"old":true}\n');
  });
});
