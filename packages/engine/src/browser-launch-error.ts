// What a browser that would not start looks like to the operator. Playwright's own text carries a
// banner, a call log and a bare `browserType.launch...` prefix; this turns the three causes an
// operator can fix (no Chromium binary, a `--cdp` endpoint nobody listens on, a file where the
// profile directory goes) into a reason plus the command to run next. Any other launch error keeps Playwright's wording. Leaf module.

import { notDirectoryProblem, redactUrl, sanitizeForTerminal } from "./cli-messages.js";

const MISSING_BINARY = /Executable doesn't exist|playwright install/i;
/** Playwright's text for a profile directory it cannot make because a file is in the way. */
const NOT_A_DIRECTORY = /ENOTDIR: not a directory, \w+ '([^'\n]+)'/;

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
  const blocked = NOT_A_DIRECTORY.exec(raw)?.[1];
  if (blocked !== undefined) return notDirectoryProblem(blocked);
  return { reason: `failed to launch browser: ${sanitizeForTerminal(raw, true)}` };
}

const NET_ERROR = /net::(ERR_[A-Z_]+)/;
const UNREACHABLE =
  /^ERR_(?:CONNECTION_(?:REFUSED|RESET|TIMED_OUT)|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)$/;

/**
 * Why `page.goto(url)` failed, in one line: the address (without user:password or query), the
 * network error code and what to change. Playwright's `page.goto:` prefix, call log and repeated
 * URL are dropped. `inspect` prints it as a warning.
 */
export function describePageLoad(raw: string, url: string): string {
  const where = redactUrl(url);
  const code = NET_ERROR.exec(raw)?.[1];
  if (code !== undefined && UNREACHABLE.test(code)) {
    return `could not load ${where} (net::${code}): the app did not answer; start it, or fix --url or app_url in .docsxai.json`;
  }
  if (code !== undefined && /^ERR_(?:CERT|SSL)_/.test(code)) {
    return `could not load ${where} (net::${code}): the TLS certificate was rejected; pass --ignore-https-errors`;
  }
  const first = sanitizeForTerminal(raw.split("\n")[0] ?? "")
    .replace(/^page\.goto: /, "")
    .replace(/ at https?:\/\/\S+$/, "");
  return `could not load ${where}: ${first}; is the app running?`;
}
