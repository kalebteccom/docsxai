// The last line of defence for the `docsxai` bin: an error no command turned into a message is a
// bug. It prints one `docsxai:` line with the error's first line and how to get the stack, and the
// stack itself when DOCSX_DEBUG is set. URLs in the text are redacted. Commands keep their own
// error wording; this only sees what they rethrow.

import {
  describeFsError,
  redactUrlsIn,
  sanitizeForTerminal,
  shellQuote,
  withNext,
} from "./cli-messages.js";
import { forwardSignalToViewer } from "./viewer-bin.js";

const ISSUES = "https://github.com/kalebteccom/docsxai/issues";

/** True when `DOCSX_DEBUG` is `1`, `true` or `yes` (any case). */
export function debugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.DOCSX_DEBUG ?? "");
}

/** The stderr text for an error that reached the bin, with the stack only when `debug` is on. */
export function unexpectedErrorText(e: unknown, debug: boolean): string {
  const raw = e instanceof Error ? e.message : String(e);
  // A file the disk or its permissions refused is the operator's to fix, not a bug to report.
  const fsLine = debug ? undefined : describeFsError(e);
  if (fsLine) return `docsxai: ${fsLine}\n`;
  const first = sanitizeForTerminal(redactUrlsIn(raw.split("\n")[0] ?? "")) || "(no message)";
  if (debug) {
    const stack = e instanceof Error && e.stack ? e.stack : raw;
    return `docsxai: unexpected error: ${first}\n${sanitizeForTerminal(redactUrlsIn(stack), true)}\n  next: report it at ${ISSUES} with the stack above\n`;
  }
  return `docsxai: ${withNext(`unexpected error: ${first}`, `rerun with DOCSX_DEBUG=1 for the stack trace, and report it at ${ISSUES}`)}\n`;
}

/** The line printed when the operator stops a command with Ctrl-C (or a SIGTERM), with the command to rerun. */
export function interruptedText(signal: string, argv: string[]): string {
  const rerun = `docsxai ${argv.map(shellQuote).join(" ")}`.trimEnd();
  return `docsxai: ${withNext(`interrupted (${signal}); anything a finished step wrote stays on disk`, `${rerun}  (the same command starts over)`)}\n`;
}

/** Milliseconds a viewer child gets to end after a signal before it is killed. */
const KILL_AFTER_MS = 10_000;

/**
 * Run `main` as the bin does: an error it throws becomes exit 1 and {@link unexpectedErrorText}, and
 * Ctrl-C or SIGTERM prints {@link interruptedText} and ends the process with exit 130 or 143. While
 * a viewer child runs, the signal goes to it and the process waits for it, then exits with the
 * child's exit code, or the signal's when the child exited 0 after being told to stop. A child that
 * has not ended `killAfterMs` later gets SIGKILL, and a second signal ends the process at once.
 */
export async function runAsBin(
  main: (argv: string[]) => Promise<number>,
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  opts: { killAfterMs?: number } = {},
): Promise<number> {
  const signals = { SIGINT: 130, SIGTERM: 143 } as const;
  let received: keyof typeof signals | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const handlers = (Object.keys(signals) as Array<keyof typeof signals>).map((sig) => {
    const handler = () => {
      if (received) {
        // The child is slow to stop and the operator asked again: stop waiting for it.
        forwardSignalToViewer("SIGKILL");
        process.exit(signals[sig]);
        return;
      }
      received = sig;
      process.stderr.write(interruptedText(sig, argv));
      // A render, burn or pack child gets the signal and ends the run itself, so its writes finish.
      if (!forwardSignalToViewer(sig)) process.exit(signals[sig]);
      else
        killTimer = setTimeout(
          () => forwardSignalToViewer("SIGKILL"),
          opts.killAfterMs ?? KILL_AFTER_MS,
        );
    };
    process.on(sig, handler);
    return [sig, handler] as const;
  });
  try {
    const code = await main(argv);
    return received && code === 0 ? signals[received] : code;
  } catch (e) {
    process.stderr.write(unexpectedErrorText(e, debugEnabled(env)));
    return 1;
  } finally {
    clearTimeout(killTimer);
    for (const [sig, handler] of handlers) process.off(sig, handler);
  }
}
