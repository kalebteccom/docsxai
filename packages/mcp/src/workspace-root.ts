// Workspace confinement for the HTTP transport. Every tool takes a filesystem path from the
// caller; over HTTP the caller is a token holder on the network, so each path has to land inside
// one operator-chosen root. Paths are resolved through symlinks before the comparison, so a link
// inside the root that points outside it is refused.

import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Raised for a bad root at startup or a path that escapes it. Messages never echo the path. */
export class WorkspaceRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRootError";
  }
}

/** Validate `--workspace-root` and return its real path: absolute, existing, a directory. */
export async function resolveWorkspaceRoot(root: string | undefined): Promise<string> {
  if (!root) throw new WorkspaceRootError("--workspace-root <dir> is required with --http");
  if (!path.isAbsolute(root)) {
    throw new WorkspaceRootError("--workspace-root must be an absolute path");
  }
  try {
    const real = await fs.realpath(root);
    if ((await fs.stat(real)).isDirectory()) return real;
  } catch {
    // fall through to the single error below
  }
  throw new WorkspaceRootError("--workspace-root must be an existing directory");
}

/** Real path of `abs`, resolving symlinks in the deepest part that exists and keeping the rest. */
async function realpathAllowingMissing(abs: string): Promise<string> {
  const missing: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const parent = path.dirname(current);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === current) {
        throw new WorkspaceRootError("the path cannot be resolved inside the workspace root");
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve `candidate` (relative paths are taken from the root) and return its real path, or throw
 * when it is not the root or inside it. The path need not exist yet. `root` must come from
 * `resolveWorkspaceRoot`.
 */
export async function resolveInsideRoot(root: string, candidate: string): Promise<string> {
  const real = await realpathAllowingMissing(path.resolve(root, candidate));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (real !== root && !real.startsWith(prefix)) {
    throw new WorkspaceRootError("the path is outside the server's workspace root");
  }
  return real;
}
