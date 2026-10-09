// Wording for backend failures in `login`, `push` and `pull`: what failed, why, and the next
// command. A refused connection reaches the CLI as a bare `TypeError: fetch failed` and a stack
// trace; this turns it into a line that names the backend and what to check. Backend URLs are
// printed without user:password, query or fragment, and text that came from the backend is stripped
// of terminal control characters.

import { promises as fs } from "node:fs";
import { BackendClientError } from "./backend-client.js";
import {
  redactUrl,
  redactUrlsIn,
  sanitizeForTerminal,
  shellQuote,
  withNext,
} from "./cli-messages.js";
import { resolveWorkspacePath, WORKSPACE_CONFIG_FILE } from "./workspace.js";

/** The error code Node's fetch buries in `cause` (ECONNREFUSED, ENOTFOUND, ...), or the message when there is none. */
function networkReason(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const cause = (e as { cause?: unknown }).cause;
  const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  if (typeof code === "string") return sanitizeForTerminal(code);
  return e instanceof TypeError && /fetch failed/i.test(e.message) ? e.message : undefined;
}

/**
 * The message for a backend failure, or `undefined` when `e` is not one (the caller rethrows it).
 * `login` is the command that signs in, so its own failures point at itself.
 */
export function explainBackendFailure(
  e: unknown,
  backendUrl: string,
  workspaceDir?: string,
): string | undefined {
  const url = redactUrl(backendUrl);
  const login = `docsxai login --backend-url ${shellQuote(url)}`;
  const reason = networkReason(e);
  if (reason !== undefined) {
    return withNext(
      `cannot reach ${url} (${reason})`,
      `check backend_url in ${WORKSPACE_CONFIG_FILE} and that the backend is running, then ${login}`,
    );
  }
  if (!(e instanceof BackendClientError)) return undefined;
  // The message carries the start of the response body, which the backend controls, and can
  // quote a URL with its credentials or query.
  const message = sanitizeForTerminal(redactUrlsIn(e.message));
  if (e.status === 401 || e.status === 403) {
    const oauth = workspaceDir
      ? `  (or add --oauth ${shellQuote(workspaceDir)} to sign in as a person)`
      : "";
    return withNext(`${message}\n  why: ${url} rejected the token`, `${login}${oauth}`);
  }
  if (e.status === 404) {
    return withNext(
      message,
      `check backend_workspace_id and backend_project_id in ${WORKSPACE_CONFIG_FILE}, or remove them and push again`,
    );
  }
  if (e.status !== undefined && e.status >= 500) {
    return withNext(
      `${message}\n  why: ${url} failed on its side`,
      "check the backend's logs, then retry",
    );
  }
  return message;
}

/** Why `.docsxai.json` did not load as a workspace config, as a phrase for parentheses. */
export async function configProblem(workspaceDir: string): Promise<string> {
  let text: string;
  try {
    text = await fs.readFile(resolveWorkspacePath(workspaceDir, WORKSPACE_CONFIG_FILE), "utf8");
  } catch {
    return "the file does not exist";
  }
  try {
    JSON.parse(text);
  } catch (e) {
    return `it is not valid JSON: ${(e as Error).message}`;
  }
  return 'its "schema" must be "docsxai/workspace@1"';
}
