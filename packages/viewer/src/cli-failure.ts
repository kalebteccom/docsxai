// What a failed `docsxai-viewer` command looks like to the operator. A write the disk refuses, or
// a file where a directory belongs, names the path and gives one `next:` line; any other error
// keeps its own message. A missing input directory is reported before anything is written, so a
// mistyped path cannot leave an empty output behind. Leaf module (node built-ins only).

import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";

const REASONS: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  EROFS: "read-only file system",
  ENOSPC: "no space left on device",
};

/** `value` as one shell word: bare when it is made of safe characters, else single-quoted. */
function shellQuote(value: string): string {
  return /^[\w./@:+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** `message` followed by the indented line naming the command to run next. */
export function withNext(message: string, next: string): string {
  return `${message}\n  next: ${next}`;
}

/** The nearest path at or above `target` that exists. */
function nearestExisting(target: string): string {
  let dir = path.resolve(target);
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** The nearest path at or above `target` that exists and is not a directory. */
async function blockingFile(target: string): Promise<string> {
  let probe = path.resolve(target);
  for (;;) {
    const stat = await fs.stat(probe).catch(() => null);
    if (stat) return stat.isDirectory() ? path.resolve(target) : probe;
    const parent = path.dirname(probe);
    if (parent === probe) return path.resolve(target);
    probe = parent;
  }
}

/** The text after `<command>: ` for an error a viewer command caught. */
export async function failureText(e: unknown): Promise<string> {
  const err = e as NodeJS.ErrnoException;
  const code = err?.code;
  const target = err?.path;
  if (code === "ENOTDIR" && target) {
    const file = await blockingFile(target);
    return withNext(
      `${file} is a file, but docsxai needs a directory there (ENOTDIR)`,
      `mv ${shellQuote(file)} ${shellQuote(`${file}.bak`)}, then rerun the command`,
    );
  }
  if (code !== undefined && code in REASONS && target) {
    const reason = `cannot access ${target} (${code}, ${REASONS[code]})`;
    if (code === "ENOSPC") return withNext(reason, "free disk space, then rerun the command");
    if (code === "EROFS") {
      return withNext(reason, "pick a directory on a writable disk, then rerun the command");
    }
    const next = existsSync(target)
      ? `chmod -R u+rw ${shellQuote(target)}  (or pick another directory), then rerun the command`
      : `chmod u+rwx ${shellQuote(nearestExisting(target))}  (or pick another directory), then rerun the command`;
    return withNext(reason, next);
  }
  return e instanceof Error ? e.message : String(e);
}

/** True when `dir` exists and is a directory. */
export async function isDirectory(dir: string): Promise<boolean> {
  return (await fs.stat(dir).catch(() => null))?.isDirectory() ?? false;
}

/**
 * Why `dir` cannot be read as an input directory: it does not exist, or it is a file. `undefined`
 * when it is a directory. `next` is the command that makes it.
 */
export async function inputDirProblem(
  dir: string,
  what: string,
  next: string,
): Promise<string | undefined> {
  const stat = await fs.stat(dir).catch(() => null);
  if (stat?.isDirectory()) return undefined;
  return withNext(
    stat ? `${what} ${dir} is a file, not a directory` : `${what} ${dir} does not exist`,
    next,
  );
}

/** {@link inputDirProblem} printed as `<command>: …` on stderr. `true` when `dir` is usable. */
export async function requireInputDir(
  command: string,
  dir: string,
  what: string,
  next: string,
): Promise<boolean> {
  const problem = await inputDirProblem(dir, what, next);
  if (problem !== undefined) process.stderr.write(`${command}: ${problem}\n`);
  return problem === undefined;
}

/** The `<command>: <error>` line for an error a viewer command caught, on stderr. Returns exit code 1. */
export async function reportFailure(command: string, e: unknown): Promise<number> {
  process.stderr.write(`${command}: ${await failureText(e)}\n`);
  return 1;
}
