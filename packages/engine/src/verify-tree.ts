// File-tree helpers for `run --verify-determinism`: list the artefacts of a run root, copy a verified
// root into the workspace, and remove a run root by the exact paths listed. No recursive delete
// anywhere: every file and directory the verifier created is named and removed one by one, so a
// path it did not list is never touched.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

/** Ordinal string order: the same on every machine, unlike `localeCompare`. */
export function byOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface TreeListing {
  /** Regular files, root-relative, `/`-separated, sorted ordinally. */
  files: string[];
  /** Directories, root-relative, `/`-separated, sorted ordinally (parents before children). */
  dirs: string[];
}

/** List every file and directory under `root`. A symlink counts as a file and is never followed. */
export async function listTree(root: string): Promise<TreeListing> {
  const files: string[] = [];
  const dirs: string[] = [];
  async function walk(rel: string[]): Promise<void> {
    const entries = await fs
      .readdir(resolveWorkspacePath(root, ...rel), { withFileTypes: true })
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
        throw e;
      });
    for (const entry of entries) {
      const next = [...rel, entry.name];
      if (entry.isDirectory()) {
        dirs.push(next.join("/"));
        await walk(next);
      } else {
        files.push(next.join("/"));
      }
    }
  }
  await walk([]);
  return { files: files.sort(byOrdinal), dirs: dirs.sort(byOrdinal) };
}

/** A run root holds something the verifier will not copy into the workspace. */
export class VerifyTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyTreeError";
  }
}

/** Throws {@link VerifyTreeError} naming the first listed entry that is not a regular file (a symlink, say). */
async function assertRegularFiles(root: string, files: string[]): Promise<void> {
  for (const rel of files) {
    const stat = await fs.lstat(resolveWorkspacePath(root, ...rel.split("/")));
    if (!stat.isFile()) {
      throw new VerifyTreeError(
        `refusing to copy ${rel}: it is ${stat.isSymbolicLink() ? "a symlink" : "not a regular file"}, and a run only writes regular files. Nothing was copied into the workspace.`,
      );
    }
  }
}

/** {@link assertRegularFiles} over everything listed under `root`. */
export async function assertRegularTree(root: string): Promise<void> {
  await assertRegularFiles(root, (await listTree(root)).files);
}

/**
 * Copy every file of `fromRoot` to the same relative path under `toRoot`. Returns the paths copied.
 * Every entry is checked with `lstat` first, so a symlink in the root stops the copy before any file moves.
 */
export async function copyTree(fromRoot: string, toRoot: string): Promise<string[]> {
  const { files } = await listTree(fromRoot);
  await assertRegularFiles(fromRoot, files);
  for (const rel of files) {
    const segments = rel.split("/");
    const dest = await resolveWorkspacePathReal(toRoot, ...segments);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(resolveWorkspacePath(fromRoot, ...segments), dest);
  }
  return files;
}

/**
 * Remove `root` and everything in it by listing it: each file is unlinked, then each directory is
 * removed deepest first, then `root` itself. A directory that is not empty after its listed
 * contents went (something else wrote there) is left in place.
 */
export async function removeListedTree(root: string): Promise<void> {
  const { files, dirs } = await listTree(root);
  for (const rel of files) {
    await fs.unlink(resolveWorkspacePath(root, ...rel.split("/"))).catch(ignoreMissing);
  }
  for (const rel of [...dirs].reverse()) {
    await fs.rmdir(resolveWorkspacePath(root, ...rel.split("/"))).catch(ignoreBusy);
  }
  await fs.rmdir(path.resolve(root)).catch(ignoreBusy);
}

function ignoreMissing(e: NodeJS.ErrnoException): void {
  if (e.code !== "ENOENT") throw e;
}

function ignoreBusy(e: NodeJS.ErrnoException): void {
  if (e.code !== "ENOENT" && e.code !== "ENOTEMPTY" && e.code !== "EEXIST") throw e;
}
