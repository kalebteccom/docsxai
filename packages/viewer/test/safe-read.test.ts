// readRegularFile refuses what is not a regular file before it opens it: a FIFO blocks an open
// until a writer appears, so it has to be caught at lstat. The size cap is also enforced on the
// bytes read, since a file can grow after the stat.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRegularFile, UnsafeFileError } from "../src/safe-read.js";

const exec = promisify(execFile);

let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-safe-read-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("readRegularFile", () => {
  it("reads a regular file, a file at the cap and an empty file", async () => {
    const file = path.join(dir, "a.bin");
    await fs.writeFile(file, Buffer.from([1, 2, 3, 4]));
    expect([...(await readRegularFile(file, 4))]).toEqual([1, 2, 3, 4]);
    await fs.writeFile(file, "");
    expect((await readRegularFile(file, 4)).byteLength).toBe(0);
  });

  it("reads a file larger than one read chunk, byte for byte", async () => {
    const file = path.join(dir, "big.bin");
    const data = Buffer.alloc(2 * 1024 * 1024 + 17, 7);
    await fs.writeFile(file, data);
    expect((await readRegularFile(file, data.byteLength)).equals(data)).toBe(true);
  });

  it("refuses a file over the cap", async () => {
    const file = path.join(dir, "a.bin");
    await fs.writeFile(file, Buffer.alloc(5));
    await expect(readRegularFile(file, 4)).rejects.toThrow(/a\.bin is larger than/);
  });

  it("refuses a directory and a symlink", async () => {
    await expect(readRegularFile(dir, 10)).rejects.toThrow(/is not a regular file/);
    const target = path.join(dir, "t.bin");
    await fs.writeFile(target, "x");
    const link = path.join(dir, "l.bin");
    await fs.symlink(target, link);
    await expect(readRegularFile(link, 10)).rejects.toThrow(/l\.bin is a symlink/);
  });

  it("rejects a missing file with the original ENOENT", async () => {
    await expect(readRegularFile(path.join(dir, "nope"), 10)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO without waiting for a writer",
    async () => {
      const fifo = path.join(dir, "pipe");
      await exec("mkfifo", [fifo]);
      const outcome = await Promise.race([
        readRegularFile(fifo, 10).then(
          () => "read",
          (e: unknown) => (e instanceof UnsafeFileError ? e.reason : String(e)),
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 5000)),
      ]);
      expect(outcome).toBe("is not a regular file");
    },
    10_000,
  );
});
