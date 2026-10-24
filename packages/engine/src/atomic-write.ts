// Write a file so a reader (or a crash, or a SIGINT) never sees half of it: the bytes go to a
// temp file in the target's directory and a rename swaps it in. A rename inside one directory is
// atomic on POSIX file systems.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Errors a Windows rename onto an existing (or open) file raises. */
const RENAME_BLOCKED = new Set(["EPERM", "EEXIST", "EBUSY", "EACCES"]);

/**
 * Write `data` to `target`: temp file next to it, then rename. An existing target keeps its mode.
 * A target that is a symlink is written in place so the link survives. When the rename is refused
 * (Windows, over an existing file) the write falls back to a plain `writeFile`.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  encoding?: BufferEncoding,
): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) {
    await fs.writeFile(target, data, encoding);
    return;
  }
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tmp, data, encoding);
    if (existing) await fs.chmod(tmp, existing.mode & 0o7777);
    try {
      await fs.rename(tmp, target);
    } catch (e) {
      if (!RENAME_BLOCKED.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
      await fs.writeFile(target, data, encoding);
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
