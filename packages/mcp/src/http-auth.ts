// Bearer-token handling for the opt-in Streamable HTTP transport. The token comes from the
// environment or a file, never from argv, and no error message here contains any part of it.

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const TOKEN_ENV_VAR = "DOCSX_MCP_TOKEN";
export const MIN_TOKEN_LENGTH = 32;

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
}

/** Refuse a token shorter than the minimum or outside the printable-ASCII range a header can carry. */
export function assertTokenStrength(token: string): void {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new TokenError(`the bearer token must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new TokenError(
      "the bearer token must be printable ASCII with no spaces (it travels in an Authorization header)",
    );
  }
}

/** Load the token from `--token-file` or `DOCSX_MCP_TOKEN` and validate it. */
export function resolveToken(opts: ResolveTokenOptions): string {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  let raw: string | undefined;
  if (opts.tokenFile) {
    try {
      raw = readFile(opts.tokenFile);
    } catch {
      throw new TokenError(`cannot read the token file at ${opts.tokenFile}`);
    }
  } else {
    raw = opts.env[TOKEN_ENV_VAR];
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
