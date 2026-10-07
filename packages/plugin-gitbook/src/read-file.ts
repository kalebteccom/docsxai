// Reads of attachment files named by a projection. The projection can come from a caller, so
// the read refuses anything but a regular file (a FIFO blocks an open until a writer shows up),
// refuses a symlink in the last path component, and caps the bytes actually read.

import { constants, promises as fs } from "node:fs";

/**
 * Largest screenshot the publisher reads. A file over the 700,000 bytes GitBook takes inline is only
 * read to be hashed and named in a warning, so the cap sits at the 4 MiB a page's batch may carry
 * and a bigger file is refused unread.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const READ_CHUNK = 1024 * 1024;

export async function readRegularFile(file: string, maxBytes = MAX_IMAGE_BYTES): Promise<Buffer> {
  const tooLarge = () => new Error(`gitbook: attachment ${file} is larger than ${maxBytes} bytes`);
  const notRegular = () => new Error(`gitbook: attachment ${file} is not a regular file`);
  const before = await fs.lstat(file);
  if (before.isSymbolicLink()) throw new Error(`gitbook: attachment ${file} is a symlink`);
  if (!before.isFile()) throw notRegular();
  const handle = await fs.open(
    file,
    constants.O_RDONLY |
      ((constants.O_NOFOLLOW as number | undefined) ?? 0) |
      // A FIFO swapped in after the lstat opens without waiting; the fstat below refuses it.
      ((constants.O_NONBLOCK as number | undefined) ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw notRegular();
    if (stat.size > maxBytes) throw tooLarge();
    // The file can grow after the fstat, so the cap is enforced on what the loop reads.
    const parts: Buffer[] = [];
    let seen = 0;
    while (seen <= maxBytes) {
      const buf = Buffer.alloc(Math.min(READ_CHUNK, maxBytes + 1 - seen));
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) return Buffer.concat(parts, seen);
      seen += bytesRead;
      parts.push(buf.subarray(0, bytesRead));
    }
    throw tooLarge();
  } finally {
    await handle.close();
  }
}
