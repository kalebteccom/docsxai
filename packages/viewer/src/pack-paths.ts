// Path checks for the workspace reader. `readRegularFile` refuses a symlink only as the last
// component of a path, so a symlinked `screenshots/` or flow directory would be followed. These
// checks cover the directories above the file. Messages name paths relative to the workspace.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { UnsafeFileError } from "./safe-read.js";

/** Throws when `file` is a symlink. A path that is not there passes; the reader reports it. */
export async function refuseSymlink(file: string, shown: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw new Error(`cannot read ${shown} (${code ?? "unknown error"})`);
  }
  if (stat.isSymbolicLink()) {
    throw new UnsafeFileError(shown, "is a symlink; pack does not follow symlinks");
  }
}

/**
 * Refuses a symlink at any of `docs/<segments[0]>`, `docs/<segments[0]>/<segments[1]>` and so on.
 * `docsDir` is the workspace's `docs` directory.
 */
export async function refuseSymlinks(docsDir: string, segments: string[]): Promise<void> {
  let dir = docsDir;
  const shown = ["docs"];
  for (const segment of segments) {
    dir = path.join(dir, segment);
    shown.push(segment);
    await refuseSymlink(dir, shown.join("/"));
  }
}

/** `name` with control characters (C0, DEL, C1) and line or paragraph separators removed, for a message. */
export function printable(name: string): string {
  let out = "";
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
    if (!control) out += ch;
  }
  return out;
}

/** Directory names for a message, comma-separated, `none` when there are no names. */
export const nameList = (names: string[]): string =>
  names.length > 0 ? names.map(printable).join(", ") : "none";

/**
 * Runs `read`; a refusal or a failed read names `shown` (a workspace-relative path) in place of the
 * absolute path the reader knows. A failure with an errno code keeps the code.
 */
export async function showingPath<T>(shown: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof UnsafeFileError) throw new UnsafeFileError(shown, e.reason);
    const code = (e as NodeJS.ErrnoException).code;
    if (typeof code === "string") {
      throw Object.assign(new Error(`cannot read ${shown} (${code})`), { code });
    }
    throw e;
  }
}
