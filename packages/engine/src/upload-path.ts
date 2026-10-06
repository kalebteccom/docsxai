// Where an `upload` step may read from. The step hands a file to the page it is driving, so a
// value that reaches outside the workspace (`/proc/self/environ`, a key under the home directory)
// would put that file in front of the app's own script. The value must be a path relative to the
// workspace root, with no `..` segment, that names a regular file whose real path (symlinks
// followed) is still under the root.

import { promises as fs } from "node:fs";
import { resolveWorkspacePathReal, WorkspacePathEscapeError } from "./workspace.js";

/** An `upload` value that reaches outside the workspace or does not name a regular file. */
export class UploadPathError extends Error {
  constructor(value: string, reason: string) {
    super(`upload path ${JSON.stringify(value)} ${reason}`);
    this.name = "UploadPathError";
  }
}

/**
 * Why `value` cannot be an upload path on its spelling alone, or null: empty, with a NUL byte,
 * absolute (a leading slash or backslash, or a drive letter) or with a `..` segment. The backend
 * keeps a copy of this rule for flow files it stores, and a test in `packages/docsxai` holds the
 * two to the same answers.
 */
export function uploadPathProblem(value: string): string | null {
  if (value === "") return "is empty";
  if (value.includes("\0")) return "contains a NUL byte";
  if (/^(?:[\\/]|[A-Za-z]:)/.test(value)) return "is an absolute path";
  if (value.split(/[\\/]+/).includes("..")) return "has a .. segment";
  return null;
}

/** The real path of the file `value` names under `root`; throws {@link UploadPathError} otherwise. */
export async function resolveUploadPath(root: string, value: string): Promise<string> {
  const spelling = uploadPathProblem(value);
  if (spelling) throw new UploadPathError(value, spelling);
  let real: string;
  try {
    real = await fs.realpath(await resolveWorkspacePathReal(root, value));
  } catch (e) {
    if (e instanceof WorkspacePathEscapeError) {
      throw new UploadPathError(value, "is outside the workspace");
    }
    throw new UploadPathError(value, "does not name a readable file under the workspace");
  }
  if (!(await fs.stat(real)).isFile()) throw new UploadPathError(value, "is not a regular file");
  return real;
}
