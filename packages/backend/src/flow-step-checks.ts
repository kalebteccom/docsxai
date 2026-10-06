// Checks on the steps of a stored flow file, made when a revision is materialised, because the
// engine acts on a step's `value` with no check of its own against a hostile tenant:
//  - `navigate` takes a path or an absolute URL. A target the project's `app_url` rules would
//    refuse is refused: an absolute URL that fails `appUrlProblem` and, when the project has an
//    `app_url`, one outside its origin. A relative value stays inside the base URL and is fine. The
//    value is resolved the way Playwright resolves it (WHATWG `URL`), so `//host/x`, `/\host` and a
//    value with embedded tabs or newlines count as absolute.
//  - `upload` names a file the engine hands to the page. It must be a path relative to the
//    workspace without `..` segments. The engine's driver also confines it at run time.

import { parse as parseYaml } from "yaml";
import { appUrlProblem } from "./app-url.js";

export interface FlowNavigationOptions {
  /** The project's `app_url`, already validated. */
  appUrl?: string | undefined;
  denyPrivate?: boolean;
}

/** A base no real URL resolves to; a value that resolves onto it is relative. */
const RELATIVE_BASE = "http://relative.docsxai.invalid/";

/** The string `value` of every step of a parsed flow file whose action is `action`, in order. */
function stepValues(flow: unknown, action: string): string[] {
  const steps = (flow as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  const values: string[] = [];
  for (const step of steps as unknown[]) {
    const { action: found, value } = (step ?? {}) as { action?: unknown; value?: unknown };
    if (found === action && typeof value === "string") values.push(value);
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
 * Why `value` cannot be a flow's upload path, or null: empty, with a NUL byte, absolute (a leading
 * slash or backslash, or a drive letter) or with a `..` segment. Same rule as `uploadPathProblem` in
 * the engine, and a test in `packages/docsxai/test` holds the two to the same answers.
 */
export function uploadPathProblem(value: string): string | null {
  if (value === "") return "is empty";
  if (value.includes("\0")) return "contains a NUL byte";
  if (/^(?:[\\/]|[A-Za-z]:)/.test(value)) return "is an absolute path";
  if (value.split(/[\\/]+/).includes("..")) return "has a .. segment";
  return null;
}

/**
 * Why the flow file's YAML text has a step it must not have, or null. Text that is not
 * valid YAML is refused too: the engine's parser is the same library, so it could not run it, and
 * a parse the two disagree on must not slip past this check.
 */
export function flowStepProblem(yamlText: string, opts: FlowNavigationOptions = {}): string | null {
  let flow: unknown;
  try {
    flow = parseYaml(yamlText);
  } catch {
    return "is not valid YAML";
  }
  for (const value of stepValues(flow, "navigate")) {
    const problem = navigateProblem(value, opts);
    if (problem) return `has a navigate step whose value ${problem}`;
  }
  for (const value of stepValues(flow, "upload")) {
    const problem = uploadPathProblem(value);
    if (problem) return `has an upload step whose value ${problem}`;
  }
  return null;
}
