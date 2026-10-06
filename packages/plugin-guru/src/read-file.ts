// Reads of attachment files named by a projection. The projection can come from a caller, so
// the read refuses anything but a regular file (a FIFO blocks an open until a writer shows up),
// refuses a symlink in the last path component, and caps the bytes actually read.

import { constants, promises as fs } from "node:fs";

/** Largest screenshot the publisher reads. */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export async function readRegularFile(file: string, maxBytes = MAX_IMAGE_BYTES): Promise<Buffer> {
  const first = await fs.lstat(file);
  if (first.isSymbolicLink()) throw new Error(`guru: attachment ${file} is a symlink`);
  if (!first.isFile()) throw new Error(`guru: attachment ${file} is not a regular file`);
  const handle = await fs.open(
    file,
    constants.O_RDONLY |
      ((constants.O_NOFOLLOW as number | undefined) ?? 0) |
      // A FIFO swapped in after the lstat opens without waiting; the fstat below refuses it.
      ((constants.O_NONBLOCK as number | undefined) ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`guru: attachment ${file} is not a regular file`);
    if (stat.size > maxBytes) {
      throw new Error(`guru: attachment ${file} is larger than ${maxBytes} bytes`);
    }
    // The file can grow after the fstat; the cap holds for the bytes actually read.
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(`guru: attachment ${file} is larger than ${maxBytes} bytes`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}
