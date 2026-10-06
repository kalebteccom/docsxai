// Halt vocabulary of the runtime: the error a halted flow throws and the one-line cause inferred
// from a driver error. Leaf module: `flow-runtime.ts` and its step helpers all import it, it
// imports none of them.

export class FlowExecutionError extends Error {
  constructor(
    message: string,
    readonly stepId: string,
    readonly cause?: unknown,
    /** Id of the matrix variant that halted; absent for a flow without a `matrix`. */
    readonly variant?: string,
  ) {
    super(message);
    this.name = "FlowExecutionError";
  }
}

/**
 * Best-effort 1-line cause extracted from a Playwright actionability log (or similar driver
 * error). Returns undefined when nothing matches — keeps the halt message short rather than
 * guessing. Surfaced as a `[cause]` prefix on the halt message so the agent doesn't have to
 * scan the multi-line actionability log.
 */
export function inferHaltCause(rawError: string): string | undefined {
  const hints: Array<[RegExp, string]> = [
    [
      /docsxai: cannot hide/i,
      "the browser can't apply the hide rule (no constructable stylesheets), so the element would stay visible",
    ],
    [/element is disabled\b/i, "target is disabled"],
    [/element is not enabled\b/i, "target is not enabled"],
    [
      /element is not visible\b/i,
      "target is not visible (display:none / visibility:hidden / zero-sized)",
    ],
    [
      /element is not attached\b/i,
      "target was detached from the DOM (likely unmounted by an earlier action)",
    ],
    [/element is outside of the viewport\b/i, "target is outside the visible viewport"],
    [/element is not stable\b/i, "target is animating / not yet stable"],
    [
      /settled: page did not settle/i,
      "page never settled: fonts, images or layout kept changing (raise timeout_ms, hide the animated element, or wait on a concrete element)",
    ],
    [
      /settled: driver has no waitForSettled/i,
      "this browser driver can't run wait_for: settled (use network_idle plus a short wait)",
    ],
    [/intercepts? pointer events\b/i, "target is covered by another element"],
    [
      /strict mode violation\b/i,
      "selector matched multiple elements (strict-mode violation) — scope with :visible / :nth-match",
    ],
    [
      /timeout .* exceeded.*waiting for/is,
      "timeout waiting for selector — element didn't appear in time (consider raising timeout_ms or revisiting the locator)",
    ],
  ];
  for (const [re, msg] of hints) {
    if (re.test(rawError)) return msg;
  }
  const resolved = rawError.match(/locator resolved to (<[^>\n]*>)/);
  if (resolved) return `target resolved to ${resolved[1]}`;
  return undefined;
}
