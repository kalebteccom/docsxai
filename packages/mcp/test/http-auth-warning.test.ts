// The token file's permission bits mean nothing on Windows, so the server says so on stderr, once
// per start. No file is read: the test injects the file seams.

import { describe, expect, it } from "vitest";
import { MIN_TOKEN_LENGTH, resolveToken, TOKEN_ENV_VAR } from "../src/http-auth.js";

const TOKEN = "unit-test-token-".padEnd(MIN_TOKEN_LENGTH + 8, "x");
const seams = { readFile: () => `${TOKEN}\n`, fileMode: () => 0o600 };

describe("resolveToken on Windows", () => {
  it("warns once that a token file's mode cannot be checked, without the path or the token", () => {
    const warnings: string[] = [];
    const token = resolveToken({
      env: {},
      tokenFile: "C:\\secrets\\mcp.token",
      platform: "win32",
      warn: (m) => warnings.push(m),
      ...seams,
    });
    expect(token).toBe(TOKEN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/permissions cannot be checked on Windows/);
    expect(warnings[0]).not.toContain(TOKEN);
    expect(warnings[0]).not.toContain("secrets");
  });

  it("says nothing on POSIX, and nothing for a token from the environment", () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    resolveToken({ env: {}, tokenFile: "/run/mcp.token", platform: "linux", warn, ...seams });
    resolveToken({ env: { [TOKEN_ENV_VAR]: TOKEN }, platform: "win32", warn });
    expect(warnings).toEqual([]);
  });
});
