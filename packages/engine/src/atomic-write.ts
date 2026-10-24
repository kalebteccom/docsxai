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
    try {
      await fs.writeFile(tmp, data, encoding);
      if (existing) await fs.chmod(tmp, existing.mode & 0o7777);
    } catch (e) {
      // The temp file's name is an implementation detail; report the file the caller asked for.
      if ((e as NodeJS.ErrnoException).path === tmp) (e as NodeJS.ErrnoException).path = target;
      throw e;
    }
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

export interface StagedFile {
  target: string;
  data: string | Uint8Array;
  encoding?: BufferEncoding;
}

interface Staged {
  tmp: string;
  dest: string;
  /** The old file, kept under this name until the whole set is in place. `undefined` for a new file. */
  backup?: string;
  swapped: boolean;
}

function siblingTemp(target: string, tag: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString("hex")}.${tag}`,
  );
}

/** Keep the old bytes of `dest` under `backup`: a hard link when the file system has them, else a copy. */
async function keepBackup(dest: string, backup: string): Promise<void> {
  try {
    await fs.link(dest, backup);
  } catch {
    await fs.copyFile(dest, backup);
  }
}

/**
 * Write several files all or nothing. Every file is first written to a temp file next to its
 * target (any failure here removes the temp files and the directories created for them, and
 * touches no target). Then each temp file is renamed over its target, the old file kept aside; if a
 * rename fails, the files already swapped are put back. Targets that are symlinks keep the link:
 * the file behind it is replaced. When two entries name one target, the last wins.
 */
export async function writeFilesTransactional(files: StagedFile[]): Promise<void> {
  const staged: Staged[] = [];
  const createdDirs: string[] = [];
  const cleanup = async (): Promise<void> => {
    for (const s of staged) {
      await fs.rm(s.tmp, { force: true });
      if (s.backup) await fs.rm(s.backup, { force: true });
    }
  };
  try {
    const byDest = new Map<string, StagedFile>();
    for (const f of files) {
      const existing = await fs.lstat(f.target).catch(() => null);
      const dest = existing?.isSymbolicLink()
        ? await fs.realpath(f.target).catch(() => f.target)
        : f.target;
      byDest.set(dest, f);
    }
    for (const [dest, f] of byDest) {
      const made = await fs.mkdir(path.dirname(dest), { recursive: true });
      if (made !== undefined) createdDirs.push(made);
      const tmp = siblingTemp(dest, "tmp");
      staged.push({ tmp, dest, swapped: false });
      await fs.writeFile(tmp, f.data, f.encoding);
      const old = await fs.stat(dest).catch(() => null);
      if (old?.isFile()) await fs.chmod(tmp, old.mode & 0o7777);
    }
  } catch (e) {
    await cleanup();
    for (const d of createdDirs) await fs.rm(d, { recursive: true, force: true });
    throw e;
  }

  try {
    for (const s of staged) {
      if (
        await fs.lstat(s.dest).then(
          () => true,
          () => false,
        )
      ) {
        s.backup = siblingTemp(s.dest, "bak");
        await keepBackup(s.dest, s.backup);
      }
      await fs.rename(s.tmp, s.dest);
      s.swapped = true;
    }
  } catch (e) {
    for (const s of [...staged].reverse()) {
      if (!s.swapped) continue;
      if (s.backup) await fs.rename(s.backup, s.dest).catch(() => undefined);
      else await fs.rm(s.dest, { force: true });
    }
    await cleanup();
    for (const d of createdDirs) await fs.rm(d, { recursive: true, force: true });
    throw e;
  }
  await cleanup();
}
