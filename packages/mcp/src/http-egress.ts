// What the HTTP transport adds around the tools that drive a browser. Over stdio the caller owns
// the machine, so a tool may attach to its Chrome over CDP and point a run at any base URL. Over
// HTTP (`ctx.workspaceRoot` set) the caller is a remote client: `cdp` is refused, a `baseUrl`
// must be an http(s) URL whose host passes the engine's address rules (resolved the way the
// request guard resolves it), and every browser the tools start gets the request guard.

import { envFlagOff, envFlagOn, requestProblem, type EgressGuardOptions } from "@docsxai/engine";
import { ToolInputError, type ToolContext } from "./shared.js";

const DENY_PRIVATE_ENV = "DOCSX_EGRESS_DENY_PRIVATE";
const GUARD_ENV = "DOCSX_EGRESS_GUARD";

/** Refuse a CDP endpoint on the HTTP transport; a no-op on stdio and when `cdp` is unset. */
export function rejectCdpOverHttp(cdp: string | undefined, ctx: ToolContext): void {
  if (cdp !== undefined && ctx.workspaceRoot) {
    throw new ToolInputError(
      "cdp is not available over the HTTP transport",
      "attach to a browser from a stdio docsxai-mcp on the machine that runs it",
    );
  }
}

/** The request guard a browser started by an HTTP tool call gets; undefined on stdio or when switched off. */
export function httpEgressGuard(
  ctx: ToolContext,
  env: NodeJS.ProcessEnv = process.env,
): EgressGuardOptions | undefined {
  if (!ctx.workspaceRoot || envFlagOff(env[GUARD_ENV])) return undefined;
  return { denyPrivate: envFlagOn(env[DENY_PRIVATE_ENV]) };
}

/**
 * Refuse a base URL the HTTP transport must not point a browser at: not an http(s) URL, or a host
 * that is, or resolves to, a link-local or metadata address (and, with `DOCSX_EGRESS_DENY_PRIVATE`,
 * a loopback or private one). The message is generic; the address stays out of it.
 */
export async function assertBaseUrlAllowed(
  baseUrl: string | undefined,
  ctx: ToolContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (baseUrl === undefined || !ctx.workspaceRoot) return;
  let allowed = false;
  try {
    const { protocol } = new URL(baseUrl);
    allowed =
      (protocol === "http:" || protocol === "https:") &&
      (await requestProblem(baseUrl, { denyPrivate: envFlagOn(env[DENY_PRIVATE_ENV]) })) === null;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    throw new ToolInputError(
      "baseUrl is not allowed over the HTTP transport",
      "use an http(s) URL whose host is a public address",
    );
  }
}
