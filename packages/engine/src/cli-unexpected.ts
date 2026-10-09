// The last line of defence for the `docsxai` bin: an error no command turned into a message is a
// bug. It prints one `docsxai:` line with the error's first line and how to get the stack, and the
// stack itself when DOCSX_DEBUG is set. URLs in the text are redacted. Commands keep their own
// error wording; this only sees what they rethrow.

import { redactUrlsIn, sanitizeForTerminal, withNext } from "./cli-messages.js";

const ISSUES = "https://github.com/kalebteccom/docsxai/issues";

/** True when `DOCSX_DEBUG` is `1`, `true` or `yes` (any case). */
export function debugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.DOCSX_DEBUG ?? "");
}

/** The stderr text for an error that reached the bin, with the stack only when `debug` is on. */
export function unexpectedErrorText(e: unknown, debug: boolean): string {
  const raw = e instanceof Error ? e.message : String(e);
  const first = sanitizeForTerminal(redactUrlsIn(raw.split("\n")[0] ?? "")) || "(no message)";
  if (debug) {
    const stack = e instanceof Error && e.stack ? e.stack : raw;
    return `docsxai: unexpected error: ${first}\n${sanitizeForTerminal(redactUrlsIn(stack), true)}\n  next: report it at ${ISSUES} with the stack above\n`;
  }
  return `docsxai: ${withNext(`unexpected error: ${first}`, `rerun with DOCSX_DEBUG=1 for the stack trace, and report it at ${ISSUES}`)}\n`;
}

/** Run `main` as the bin does: an error it throws becomes exit 1 and {@link unexpectedErrorText}. */
export async function runAsBin(
  main: (argv: string[]) => Promise<number>,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    return await main(argv);
  } catch (e) {
    process.stderr.write(unexpectedErrorText(e, debugEnabled(env)));
    return 1;
  }
}
