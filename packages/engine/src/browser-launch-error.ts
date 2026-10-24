// What a browser that would not start looks like to the operator. Playwright's own text carries a
// banner, a call log and a bare `browserType.launch...` prefix; this turns the two causes an
// operator can fix (no Chromium binary, a `--cdp` endpoint nobody listens on) into a reason plus
// the command to run next. Any other launch error keeps Playwright's wording. Leaf module.

import { redactUrl, sanitizeForTerminal } from "./cli-messages.js";

const MISSING_BINARY = /Executable doesn't exist|playwright install/i;

/** The command that installs the Chromium binary Playwright looks for. */
export const CHROMIUM_INSTALL =
  "npx playwright-core install chromium  (source checkout: pnpm -C packages/engine exec playwright-core install chromium)";

/** The start of the reason `describeBrowserLaunch` gives for a refused `--cdp` endpoint. */
export const CDP_UNREACHABLE = "cannot attach to the browser at";

export interface BrowserLaunchProblem {
  /** One line: what failed and why. */
  reason: string;
  /** The command to run next, when the cause is one the operator can fix. */
  next?: string;
}

/** The port of a `--cdp` endpoint, for the Chrome flag in the hint. */
function cdpPort(endpoint: string): string {
  try {
    return new URL(endpoint).port || "9222";
  } catch {
    return "9222";
  }
}

/** Explain a launch or attach error from Playwright. `cdp` is the `--cdp` endpoint when one was given. */
export function describeBrowserLaunch(raw: string, cdp?: string): BrowserLaunchProblem {
  if (cdp !== undefined && /connectOverCDP/.test(raw)) {
    const code = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET)\b/.exec(raw)?.[1];
    const first = sanitizeForTerminal(raw.split("\n")[0] ?? "");
    return {
      reason: `${CDP_UNREACHABLE} ${redactUrl(cdp)} (${code ?? first}); --cdp needs a running Chrome`,
      next: `start Chrome with --remote-debugging-port=${cdpPort(cdp)}, then rerun the command`,
    };
  }
  if (MISSING_BINARY.test(raw)) {
    return {
      reason: "no Chromium binary found",
      next: `${CHROMIUM_INSTALL}, then rerun the command`,
    };
  }
  return { reason: `failed to launch browser: ${sanitizeForTerminal(raw, true)}` };
}
