// Bearer-token handling for the opt-in Streamable HTTP transport. The token comes from the
// environment or a file, never from argv, and no error message here contains any part of it.

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export const TOKEN_ENV_VAR = "DOCSX_MCP_TOKEN";
export const MIN_TOKEN_LENGTH = 32;
export const MIN_DISTINCT_CHARS = 8;

/** Raised for a missing, unreadable or weak token. The message never carries token material. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

export interface ResolveTokenOptions {
  env: NodeJS.ProcessEnv;
  /** Path from `--token-file`; wins over the environment variable when both are set. */
  tokenFile?: string;
  /** Test seam for the file read. */
  readFile?: (path: string) => string;
  /** Test seam for the file's permission bits. */
  fileMode?: (path: string) => number;
  /** Test seam for the platform check. Default: `process.platform`. */
  platform?: NodeJS.Platform;
  /** Where the one-time Windows warning goes. Default: stderr. */
  warn?: (message: string) => void;
}

/**
 * Refuse a token shorter than the minimum, outside the printable-ASCII range a header can carry,
 * or built from fewer than 8 distinct characters (a run like `aaaa...` passes the length check
 * and carries no entropy).
 */
export function assertTokenStrength(token: string): void {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new TokenError(`the bearer token must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new TokenError(
      "the bearer token must be printable ASCII with no spaces (it travels in an Authorization header)",
    );
  }
  if (new Set(token).size < MIN_DISTINCT_CHARS) {
    throw new TokenError(
      `the bearer token is too repetitive: use at least ${MIN_DISTINCT_CHARS} distinct characters`,
    );
  }
}

/** True when group or other can read, write or execute the file. Always false on Windows. */
function isGroupOrOtherAccessible(mode: number): boolean {
  return process.platform !== "win32" && (mode & 0o077) !== 0;
}

/**
 * Load the token from `--token-file` or `DOCSX_MCP_TOKEN` and validate it. A token file readable
 * by group or other is refused on POSIX. The variable is deleted from `opts.env` once read, so
 * child processes the tools spawn (the viewer build, a browser) do not inherit the token.
 */
export function resolveToken(opts: ResolveTokenOptions): string {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const fileMode = opts.fileMode ?? ((p: string) => statSync(p).mode);
  const fromEnv = opts.env[TOKEN_ENV_VAR];
  delete opts.env[TOKEN_ENV_VAR];
  let raw: string | undefined;
  if (opts.tokenFile) {
    const unreadable = new TokenError(`cannot read the token file at ${opts.tokenFile}`);
    let mode: number;
    try {
      mode = fileMode(opts.tokenFile);
    } catch {
      throw unreadable;
    }
    if ((opts.platform ?? process.platform) === "win32") {
      const warn = opts.warn ?? ((m: string) => process.stderr.write(m));
      warn(
        "docsxai-mcp: the token file's permissions cannot be checked on Windows; " +
          "keep it readable only by the account that runs the server\n",
      );
    }
    if (isGroupOrOtherAccessible(mode)) {
      throw new TokenError(
        `the token file at ${opts.tokenFile} is readable by group or other; run chmod 600 on it`,
      );
    }
    try {
      raw = readFile(opts.tokenFile);
    } catch {
      throw unreadable;
    }
  } else {
    raw = fromEnv;
  }
  const token = raw?.trim() ?? "";
  if (!token) {
    throw new TokenError(
      `a bearer token is required: set ${TOKEN_ENV_VAR} or pass --token-file <path>`,
    );
  }
  assertTokenStrength(token);
  return token;
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * Build a verifier for `Authorization` header values. Both sides are hashed to a fixed length
 * first, so the comparison is constant-time and does not leak the token length.
 */
export function createBearerVerifier(token: string): (header: string | undefined) => boolean {
  const expected = digest(token);
  return (header) => {
    const match = typeof header === "string" ? /^bearer +(\S+)$/i.exec(header) : null;
    const presented = digest(match?.[1] ?? "");
    // Always compare, so a missing header costs the same as a wrong one.
    return timingSafeEqual(presented, expected) && match !== null;
  };
}
