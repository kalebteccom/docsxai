// Turns a failed backend call (push_pack, pull_pack) into the { ok: false, error, hint } pair. The
// hint depends on what went wrong, because "is the token valid" is the wrong advice for a refused
// connection or a wrong project id. An agent cannot sign in itself, so the sign-in hints say who
// has to.

import { BackendClientError } from "@docsxai/engine";
import { fail, type ToolContext, type ToolFail } from "./shared.js";

const SIGN_IN_HINT =
  "a person has to sign in on the machine that runs docsxai-mcp (`docsxai login`, or set " +
  "DOCSX_TOKEN there), then retry";

/** The error code Node's fetch buries in `cause` (ECONNREFUSED, ENOTFOUND, ...), if it is a plain code. */
function networkCode(e: Error): string | undefined {
  const cause = (e as { cause?: unknown }).cause;
  const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : undefined;
}

/**
 * A fixed message for a backend error. The engine's text carries the start of the response body,
 * which the backend controls, and the sign-in errors name credential sources; an HTTP caller
 * gets neither.
 */
function genericMessage(status: number | undefined, signIn: boolean): string {
  if (signIn) return "the server has no accepted backend credentials";
  const suffix = status === undefined ? "" : ` (HTTP ${status})`;
  if (status === 404)
    return `the backend does not know that workspace, project or revision${suffix}`;
  if (status !== undefined && status >= 500) return `the backend failed on its side${suffix}`;
  return `the backend request failed${suffix}`;
}

/**
 * The failure result for a backend error, or `undefined` when `e` is not one (rethrow it). Over
 * HTTP (`ctx.workspaceRoot` set) the error text is a fixed sentence.
 */
export function backendFailure(e: unknown, ctx: ToolContext = {}): ToolFail | undefined {
  if (e instanceof BackendClientError) {
    const { status } = e;
    const signIn =
      status === 401 || status === 403 || /no bearer token|refresh failed/.test(e.message);
    const message = ctx.workspaceRoot ? genericMessage(status, signIn) : e.message;
    if (signIn) return fail(message, SIGN_IN_HINT);
    if (status === 404) {
      return fail(
        message,
        "check backend_workspace_id, backend_project_id and the revision id; remove the two ids " +
          "from .docsxai.json and push_pack again to create new ones",
      );
    }
    if (status !== undefined && status >= 500) {
      return fail(message, "the backend failed on its side; retry later or check its logs");
    }
    return fail(message, "check backend_url in .docsxai.json and that the backend is reachable");
  }
  if (e instanceof TypeError && /fetch failed/i.test(e.message)) {
    const code = networkCode(e);
    return fail(
      `cannot reach the backend${code ? ` (${code})` : ""}`,
      "check backend_url in .docsxai.json and that the backend is running, then retry",
    );
  }
  return undefined;
}
