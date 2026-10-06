// Reads of files the pack commands do not produce themselves (a committed pack, a raw capture).
// A symlink in such a directory could point anywhere on the disk, so these reads refuse one, refuse
// anything that is not a regular file and refuse a file above a size cap.

import { constants, promises as fs } from "node:fs";

/** Largest PNG read from a committed pack or a raw capture. */
export const MAX_PNG_BYTES = 64 * 1024 * 1024;

/** Largest JSON file (manifest, sidecar, config) read from those directories. */
export const MAX_JSON_BYTES = 16 * 1024 * 1024;

/** A file the reader refused. `reason` completes "<file> ..." and carries no path. */
export class UnsafeFileError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(`${file} ${reason}`);
    this.name = "UnsafeFileError";
  }
}

function sizeLabel(maxBytes: number): string {
  return `${maxBytes / (1024 * 1024)} MiB`;
}

/**
 * The bytes of a regular file of at most `maxBytes`. A missing file rejects with the original
 * `ENOENT` error. A symlink, a directory, a device or an oversized file rejects with
 * {@link UnsafeFileError}. The open itself does not follow a symlink, so a link swapped in after
 * the first check is refused too.
 */
export async function readRegularFile(file: string, maxBytes: number): Promise<Buffer> {
  if ((await fs.lstat(file)).isSymbolicLink()) {
    throw new UnsafeFileError(file, "is a symlink");
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      file,
      constants.O_RDONLY | ((constants.O_NOFOLLOW as number | undefined) ?? 0),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ELOOP")
      throw new UnsafeFileError(file, "is a symlink");
    throw e;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new UnsafeFileError(file, "is not a regular file");
    if (stat.size > maxBytes) {
      throw new UnsafeFileError(file, `is larger than ${sizeLabel(maxBytes)}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
