// A flow's `navigate` step takes a path or an absolute URL, and the engine opens either with no
// host check. Materialising a revision therefore reads every flow file and refuses a navigate
// target the project's `app_url` rules would refuse: an absolute URL that fails `appUrlProblem`,
// and, when the project has an `app_url`, one outside its origin. A relative value stays inside the
// base URL and is fine. The value is resolved the way Playwright resolves it (WHATWG `URL`), so
// `//host/x`, `/\host` and a value with embedded tabs or newlines count as absolute.

import { parse as parseYaml } from "yaml";
import { appUrlProblem } from "./app-url.js";

export interface FlowNavigationOptions {
  /** The project's `app_url`, already validated. */
  appUrl?: string | undefined;
  denyPrivate?: boolean;
}

/** A base no real URL resolves to; a value that resolves onto it is relative. */
const RELATIVE_BASE = "http://relative.docsxai.invalid/";

/** The `navigate` step values of a parsed flow file, in order. */
function navigateValues(flow: unknown): string[] {
  const steps = (flow as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  const values: string[] = [];
  for (const step of steps as unknown[]) {
    const { action, value } = (step ?? {}) as { action?: unknown; value?: unknown };
    if (action === "navigate" && typeof value === "string") values.push(value);
  }
  return values;
}

/** Why `value` cannot be a flow's navigate target under `opts`, or null. */
export function navigateProblem(value: string, opts: FlowNavigationOptions = {}): string | null {
  let resolved: URL;
  try {
    resolved = new URL(value, opts.appUrl ?? RELATIVE_BASE);
  } catch {
    return "is not a path or an absolute URL";
  }
  if (!opts.appUrl && resolved.origin === new URL(RELATIVE_BASE).origin) return null;
  if (opts.appUrl && resolved.origin === new URL(opts.appUrl).origin) return null;
  const refused = appUrlProblem(resolved.href, { denyPrivate: opts.denyPrivate === true });
  if (refused) return refused.replace(/^app_url /, "");
  return opts.appUrl ? "is outside the app_url origin" : null;
}

/**
 * Why the flow file's YAML text has a navigate target it must not have, or null. Text that is not
 * valid YAML is refused too: the engine's parser is the same library, so it could not run it, and
 * a parse the two disagree on must not slip past this check.
 */
export function flowNavigationProblem(
  yamlText: string,
  opts: FlowNavigationOptions = {},
): string | null {
  let flow: unknown;
  try {
    flow = parseYaml(yamlText);
  } catch {
    return "is not valid YAML";
  }
  for (const value of navigateValues(flow)) {
    const problem = navigateProblem(value, opts);
    if (problem) return `has a navigate step whose value ${problem}`;
  }
  return null;
}
