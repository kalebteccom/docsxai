// POSIX shell quoting for the commands a page offers to copy. A step id or flow name may hold
// spaces, quotes or `$`, and the command is pasted into a terminal as written. Leaf: no imports.

const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** `s` as one POSIX shell word: bare when it has only safe characters, else single-quoted. */
export function shellQuote(s: string): string {
  if (PLAIN.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The same function as source text, for the generated Astro component that runs in the build. */
export const SHELL_QUOTE_SRC = `const shellQuote = (s) =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\\\''") + "'";`;

/** `docsxai run` for one step, the command that captures its screenshot again. */
export function recaptureCommand(flow: string | undefined, stepId: string): string {
  const only = flow ? ` --flow ${shellQuote(flow.split("/")[0]!)}` : "";
  return `docsxai run <workspace>${only} --start-from ${shellQuote(stepId)}`;
}
