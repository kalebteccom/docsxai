// Shared wording for CLI errors. A failing command says what failed, why, and the next command to
// run, in that order, on `<command>: ` lines with an indented `next:` line. Usage errors show the
// failing command's own usage line instead of the whole help text. Leaf: imports only the help text.

import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { USAGE } from "./cli-usage.js";

/** The `Usage:` entries of `docsxai --help`, one whitespace-normalised line per entry. */
function usageEntries(): string[] {
  const start = USAGE.indexOf("Usage:\n");
  const end = USAGE.indexOf("\n\nNotes:");
  if (start < 0 || end < 0) return [];
  const entries: string[] = [];
  for (const line of USAGE.slice(start + "Usage:\n".length, end).split("\n")) {
    if (/^ {2}docsxai /.test(line)) entries.push(line.trim());
    else if (entries.length > 0) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  return entries.map((e) => e.replace(/\s+/g, " "));
}

/** The usage lines of the command named by the first word of `label` (`pack --check` gives both `pack` lines). */
export function commandUsage(label: string): string[] {
  const name = label.split(" ")[0];
  return usageEntries().filter((e) => e.split(" ")[1] === name);
}

/** Print `<label>: <message>`, the command's usage line and a pointer to `--help` on stderr. Returns exit code 2. */
export function usageError(label: string, message: string): number {
  const lines = commandUsage(label).map((l, i) => `${i === 0 ? "usage: " : "       "}${l}\n`);
  process.stderr.write(
    `${label}: ${message}\n${lines.join("")}run \`docsxai --help\` for every flag and an example\n`,
  );
  return 2;
}

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * `text` with every C0 control character, DEL and C1 control character removed, so text that came
 * from a backend or a flow file cannot move the cursor, recolour the terminal or set its title. A
 * newline, carriage return or tab becomes a space, so the text stays on its own line. With
 * `multiline`, newlines and tabs are kept (the carriage return is still dropped).
 */
export function sanitizeForTerminal(text: string, multiline = false): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || code === 0x09) out += multiline ? ch : " ";
    else if (code === 0x0d) out += multiline ? "" : " ";
    else if (!isControl(code)) out += ch;
  }
  return out;
}

/** `value` as one shell word: left bare when it is made of safe characters, else single-quoted. */
export function shellQuote(value: string): string {
  const v = sanitizeForTerminal(value);
  return /^[\w./@:+-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`;
}

/** `message` followed by the indented line naming the command to run next. */
export function withNext(message: string, next: string): string {
  return `${sanitizeForTerminal(message, true)}\n  next: ${sanitizeForTerminal(next)}`;
}

/** `raw` without user:password, query or fragment, for printing a URL the operator typed. */
export function redactUrl(raw: string): string {
  const invalid = "<invalid url>";
  try {
    const u = new URL(raw);
    // An `@` in the path means the operator's userinfo held a `/` (or `\`): the URL parser read
    // everything after it as a path, so the secret sits in the pathname.
    if (u.pathname.includes("@")) return invalid;
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return sanitizeForTerminal(u.toString().replace(/\/$/, ""));
  } catch {
    return invalid;
  }
}

/**
 * `text` with every absolute URL in it passed through {@link redactUrl}. Error messages from
 * `fetch` and from a backend can quote the URL they were given, user:password and query included.
 */
export function redactUrlsIn(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()`]+/gi, (url) => redactUrl(url));
}

const FS_REASONS: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  EROFS: "read-only file system",
  ENOSPC: "no space left on device",
};

/** The code of a file-system error the operator fixes: `EACCES`, `EPERM`, `EROFS` or `ENOSPC`. `undefined` for any other error. */
export function fsErrorCode(e: unknown): string | undefined {
  const code = e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined;
  return code !== undefined && code in FS_REASONS ? code : undefined;
}

/** The command to run after a file operation failed with `code` at `target` (when known). */
export function fsNext(code: string, target?: string): string {
  if (code === "ENOSPC") return "free disk space, then rerun the command";
  if (code === "EROFS") return "pick a directory on a writable disk, then rerun the command";
  return target
    ? `chmod -R u+rw ${shellQuote(target)}  (or pick another directory), then rerun the command`
    : "make the directory accessible (or pick another one), then rerun the command";
}

/** The nearest directory above `target` (or `target` itself) that exists, for a chmod when `target` is yet to be made. */
function nearestExisting(target: string): string {
  let dir = path.resolve(target);
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** What went wrong with a file operation and the command to run next, as two parts for callers that print them apart. */
export interface FsProblem {
  reason: string;
  next: string;
}

/** The nearest path at or above `target` that exists and is not a directory: the file standing where a directory should be. */
function blockingFile(target: string): string | undefined {
  let probe = path.resolve(target);
  for (;;) {
    try {
      return statSync(probe).isDirectory() ? undefined : probe;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return undefined;
      probe = parent;
    }
  }
}

/**
 * The problem when `target` (or a directory under it) is a file: names the file, says a directory is
 * needed there, and moves the file aside. `target` is the path the failing call named, when known.
 */
export function notDirectoryProblem(target?: string): FsProblem {
  const file = target ? (blockingFile(target) ?? path.resolve(target)) : undefined;
  if (file === undefined) {
    return {
      reason: "a file stands where docsxai needs a directory (ENOTDIR)",
      next: "move the file aside, then rerun the command",
    };
  }
  const shown = redactUrlsIn(file);
  return {
    reason: `${shown} is a file, but docsxai needs a directory there (ENOTDIR)`,
    next: `mv ${shellQuote(file)} ${shellQuote(`${file}.bak`)}, then rerun the command`,
  };
}

/**
 * {@link describeFsError} as a reason and a next step: for `EACCES`, `EPERM`, `EROFS`, `ENOSPC` and
 * `ENOTDIR`. `undefined` for any other error.
 */
export function describeFsProblem(
  e: unknown,
  opts: { creating?: boolean } = {},
): FsProblem | undefined {
  const target = e instanceof Error ? (e as NodeJS.ErrnoException).path : undefined;
  if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOTDIR") {
    return notDirectoryProblem(target);
  }
  const code = fsErrorCode(e);
  if (code === undefined) return undefined;
  const where = target ? ` ${redactUrlsIn(target)}` : "";
  const parent = opts.creating && target && (code === "EACCES" || code === "EPERM");
  const next = parent
    ? `chmod u+rwx ${shellQuote(nearestExisting(target))}  (or pick another directory), then rerun the command`
    : fsNext(code, target);
  return { reason: `cannot access${where} (${code}, ${FS_REASONS[code]})`, next };
}

/**
 * A line for a file operation that failed with {@link fsErrorCode}, or with `ENOTDIR`: what failed,
 * why, and the next command. `undefined` for any other error, so the caller keeps its own wording.
 * With `creating`, a refused `mkdir` names the nearest existing parent in the chmod, because the path
 * that failed is not there to change.
 */
export function describeFsError(e: unknown, opts: { creating?: boolean } = {}): string | undefined {
  const problem = describeFsProblem(e, opts);
  return problem ? withNext(problem.reason, problem.next) : undefined;
}
