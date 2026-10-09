// Shared wording for CLI errors. A failing command says what failed, why, and the next command to
// run, in that order, on `<command>: ` lines with an indented `next:` line. Usage errors show the
// failing command's own usage line instead of the whole help text. Leaf: imports only the help text.

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
