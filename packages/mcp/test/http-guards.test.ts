// Unit tests for the Streamable HTTP transport's pure pieces: token loading and comparison, the
// bind policy, the Host / Origin allowlists and the `serve` argument parser. No sockets.

import { describe, expect, it } from "vitest";
import { parseBinArgs } from "../src/bin.js";
import {
  assertTokenStrength,
  createBearerVerifier,
  MIN_TOKEN_LENGTH,
  resolveToken,
  TOKEN_ENV_VAR,
  TokenError,
} from "../src/http-auth.js";
import {
  assertBindPolicy,
  BindPolicyError,
  buildAllowedHosts,
  hostHeaderAllowed,
  isLoopbackHost,
  normalizeHostname,
  originAllowed,
} from "../src/http-guard.js";
import { parseServeArgs } from "../src/serve-args.js";

const TOKEN = "unit-test-token-".padEnd(MIN_TOKEN_LENGTH + 8, "x");

/** The error `fn` throws; fails the test when it does not throw. */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw");
}

describe("resolveToken", () => {
  it("refuses to start without a token and names both places to put one", () => {
    expect(() => resolveToken({ env: {} })).toThrow(TokenError);
    expect(() => resolveToken({ env: {} })).toThrow(new RegExp(`${TOKEN_ENV_VAR}.*--token-file`));
    expect(() => resolveToken({ env: { [TOKEN_ENV_VAR]: "   " } })).toThrow(/token is required/);
  });

  it("refuses a token shorter than 32 characters and accepts exactly 32", () => {
    const short = "s".repeat(MIN_TOKEN_LENGTH - 1);
    expect(() => resolveToken({ env: { [TOKEN_ENV_VAR]: short } })).toThrow(/at least 32/);
    const exact = "e".repeat(MIN_TOKEN_LENGTH);
    expect(resolveToken({ env: { [TOKEN_ENV_VAR]: exact } })).toBe(exact);
  });

  it("never puts token material in an error message", () => {
    const short = "secret-short-value";
    for (const env of [{ [TOKEN_ENV_VAR]: short }, { [TOKEN_ENV_VAR]: `${TOKEN} with space` }]) {
      const message = thrown(() => resolveToken({ env })).message;
      expect(message).not.toContain(short);
      expect(message).not.toContain(TOKEN);
    }
  });

  it("refuses characters a header cannot carry", () => {
    expect(() => assertTokenStrength(`${TOKEN} tail`)).toThrow(/printable ASCII/);
    expect(() => assertTokenStrength(`${TOKEN}é`)).toThrow(/printable ASCII/);
  });

  it("reads --token-file in preference to the environment and trims the trailing newline", () => {
    const token = resolveToken({
      env: { [TOKEN_ENV_VAR]: "e".repeat(40) },
      tokenFile: "/run/secrets/mcp-token",
      readFile: (p) => (p === "/run/secrets/mcp-token" ? `${TOKEN}\n` : ""),
    });
    expect(token).toBe(TOKEN);
  });

  it("reports an unreadable token file by path only", () => {
    const run = (): string =>
      resolveToken({
        env: {},
        tokenFile: "/nope/token",
        readFile: () => {
          throw new Error(`ENOENT leaked ${TOKEN}`);
        },
      });
    expect(run).toThrow(/cannot read the token file at \/nope\/token/);
    expect(thrown(run).message).not.toContain(TOKEN);
  });
});

describe("createBearerVerifier", () => {
  const verify = createBearerVerifier(TOKEN);

  it("accepts the token under a case-insensitive Bearer scheme", () => {
    expect(verify(`Bearer ${TOKEN}`)).toBe(true);
    expect(verify(`bearer ${TOKEN}`)).toBe(true);
  });

  it("rejects a missing header, another scheme, a wrong token and a prefix of the token", () => {
    expect(verify(undefined)).toBe(false);
    expect(verify("")).toBe(false);
    expect(verify(TOKEN)).toBe(false);
    expect(verify(`Basic ${TOKEN}`)).toBe(false);
    expect(verify(`Bearer ${TOKEN}x`)).toBe(false);
    expect(verify(`Bearer ${TOKEN.slice(0, -1)}`)).toBe(false);
    expect(verify(`Bearer ${TOKEN} extra`)).toBe(false);
  });
});

describe("bind policy", () => {
  it("treats the loopback names and the 127/8 block as loopback", () => {
    for (const h of ["127.0.0.1", "127.9.9.9", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of ["0.0.0.0", "::", "192.168.1.10", "example.com", "127.0.0.1.evil.test"]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it("refuses a non-loopback host unless --allow-remote is passed", () => {
    expect(() => assertBindPolicy("0.0.0.0", false)).toThrow(BindPolicyError);
    expect(() => assertBindPolicy("0.0.0.0", false)).toThrow(/--allow-remote/);
    expect(() => assertBindPolicy("10.0.0.5", true)).not.toThrow();
    expect(() => assertBindPolicy("127.0.0.1", false)).not.toThrow();
  });
});

describe("Host and Origin allowlists", () => {
  const allowed = buildAllowedHosts("127.0.0.1", ["Docs.Internal.Example:8443"]);

  it("normalizes ports, case and IPv6 brackets", () => {
    expect(normalizeHostname("LocalHost:8765")).toBe("localhost");
    expect(normalizeHostname("[::1]:8765")).toBe("::1");
    expect(normalizeHostname("::1")).toBe("::1");
    expect(normalizeHostname("")).toBeUndefined();
    expect(normalizeHostname(":80")).toBeUndefined();
  });

  it("accepts loopback names and configured hosts in the Host header", () => {
    for (const h of ["127.0.0.1:8765", "localhost:1", "[::1]:8765", "docs.internal.example"]) {
      expect(hostHeaderAllowed(h, allowed), h).toBe(true);
    }
  });

  it("rejects a missing or foreign Host header", () => {
    for (const h of [undefined, "", "evil.example", "evil.example:8765", "localhost.evil.test"]) {
      expect(hostHeaderAllowed(h, allowed), String(h)).toBe(false);
    }
  });

  it("lets a request with no Origin through and judges a present one by hostname", () => {
    expect(originAllowed(undefined, allowed)).toBe(true);
    expect(originAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(originAllowed("https://docs.internal.example", allowed)).toBe(true);
    expect(originAllowed("http://[::1]:3000", allowed)).toBe(true);
    expect(originAllowed("https://evil.example", allowed)).toBe(false);
    expect(originAllowed("null", allowed)).toBe(false);
    expect(originAllowed("", allowed)).toBe(false);
  });

  it("adds a concrete bind host but not a wildcard one", () => {
    expect(buildAllowedHosts("10.0.0.5", []).has("10.0.0.5")).toBe(true);
    expect(buildAllowedHosts("0.0.0.0", []).has("0.0.0.0")).toBe(false);
  });

  it("refuses wildcard and malformed --allowed-host entries", () => {
    for (const bad of ["*.example.com", "*", "http://example.com", "a b", "user@example.com"]) {
      expect(() => buildAllowedHosts("127.0.0.1", [bad]), bad).toThrow(BindPolicyError);
    }
  });
});

describe("serve arguments", () => {
  it("parses serve --http with every option", () => {
    const parsed = parseBinArgs([
      "serve",
      "--http",
      "--port",
      "9000",
      "--host",
      "0.0.0.0",
      "--allow-remote",
      "--allowed-host",
      "a.example",
      "--allowed-host",
      "b.example",
      "--token-file",
      "/tmp/t",
      "--workspace",
      "/tmp/ws",
    ]);
    expect(parsed).toEqual({
      workspace: "/tmp/ws",
      help: false,
      serve: {
        port: 9000,
        host: "0.0.0.0",
        allowRemote: true,
        allowedHosts: ["a.example", "b.example"],
        tokenFile: "/tmp/t",
      },
    });
  });

  it("defaults to no remote, no extra hosts and leaves host and port to the server", () => {
    expect(parseServeArgs(["--http"])).toEqual({
      help: false,
      serve: { allowRemote: false, allowedHosts: [] },
    });
  });

  it("needs --http, and still answers --help without it", () => {
    expect(() => parseServeArgs([])).toThrow(/pass --http/);
    expect(parseServeArgs(["--help"]).help).toBe(true);
  });

  it("validates --port", () => {
    for (const bad of ["abc", "-1", "65536", "1.5", "", "123456"]) {
      expect(() => parseServeArgs(["--http", "--port", bad]), bad).toThrow(/--port|requires/);
    }
    expect(parseServeArgs(["--http", "--port", "0"]).serve.port).toBe(0);
    expect(() => parseServeArgs(["--http", "--port"])).toThrow(/requires a <port> value/);
  });

  it("refuses a token on the command line without echoing it", () => {
    const secret = "cli-secret-value-1234567890abcdef";
    for (const argv of [
      ["serve", "--http", `--token=${secret}`],
      ["serve", "--http", "--token", secret],
      ["serve", "--http", `--token-file=${secret}`],
      [`--token=${secret}`],
    ]) {
      const message = thrown(() => parseBinArgs(argv)).message;
      expect(message).toMatch(/never read from arguments/);
      expect(message).not.toContain(secret);
    }
  });

  it("does not echo a stray positional argument", () => {
    const secret = "positional-secret-value-1234567890";
    expect(thrown(() => parseServeArgs(["--http", secret])).message).not.toContain(secret);
    expect(() => parseServeArgs(["--http", "--bogus=1"])).toThrow(/unknown argument: --bogus$/);
  });

  it("leaves the stdio argument shape unchanged", () => {
    expect(parseBinArgs(["--workspace", "/tmp/ws"])).toEqual({ workspace: "/tmp/ws", help: false });
  });
});
