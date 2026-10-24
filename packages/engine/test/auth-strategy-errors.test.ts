// auth/strategy.yaml under zod 4: defaults on optional fields (including the nested cache object),
// the printed path of a bad value in a record or a union, strict keys, and option errors that
// name keys and never values.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthStrategyConfigError,
  parseAuthStrategyFile,
  parseStrategyOptions,
} from "../src/auth.js";

const role = (body = ""): string =>
  `schema: docsxai/auth-strategy@1\ndefault_role: editor\nroles:\n  editor:\n    strategy: manual-capture\n${body}`;

const messageOf = (text: string): string => {
  try {
    parseAuthStrategyFile(text, "strategy.yaml");
  } catch (e) {
    expect(e).toBeInstanceOf(AuthStrategyConfigError);
    return (e as Error).message;
  }
  throw new Error("expected parseAuthStrategyFile to throw");
};
const cacheOf = (body: string) => parseAuthStrategyFile(role(body)).roles["editor"]!.cache;

describe("defaults on optional fields", () => {
  it("fills in the whole cache object, creds_env and options when they are absent", () => {
    const editor = parseAuthStrategyFile(role()).roles["editor"]!;
    expect(editor.cache).toEqual({ enabled: false, store: "local", ttl: "session" });
    expect(editor.creds_env).toEqual({});
    expect(editor.options).toEqual({});
  });

  it("fills in the cache keys that a partial cache leaves out", () => {
    expect(cacheOf("    cache: {}\n")).toEqual({ enabled: false, store: "local", ttl: "session" });
    expect(cacheOf("    cache: { enabled: true }\n")).toEqual({
      enabled: true,
      store: "local",
      ttl: "session",
    });
    expect(cacheOf("    cache: { auth_cookie: sid }\n")).toEqual({
      enabled: false,
      store: "local",
      ttl: "session",
      auth_cookie: "sid",
    });
  });

  it("hands each parse its own defaults", () => {
    const first = parseAuthStrategyFile(role()).roles["editor"]!;
    first.creds_env["USER"] = "X";
    first.options["a"] = 1;
    first.cache.enabled = true;
    const second = parseAuthStrategyFile(role()).roles["editor"]!;
    expect(second.creds_env).toEqual({});
    expect(second.options).toEqual({});
    expect(second.cache.enabled).toBe(false);
  });

  it("does not default a null, and names the field that was null", () => {
    expect(messageOf(role("    cache: null\n"))).toContain(
      "  • roles.editor.cache: Invalid input: expected object, received null",
    );
    expect(messageOf(role("    creds_env: null\n"))).toContain(
      "  • roles.editor.creds_env: Invalid input: expected record, received null",
    );
  });
});

describe("the cache ttl, a union of three shapes", () => {
  it.each([["session"], ["30m"], ["500ms"], [3600000]])("accepts %j", (ttl) => {
    expect(cacheOf(`    cache: { ttl: ${JSON.stringify(ttl)} }\n`).ttl).toBe(ttl);
  });

  it.each([["1d"], [""], [0], [1.5], [true]])("names roles.editor.cache.ttl for %j", (ttl) => {
    const lines = messageOf(role(`    cache: { ttl: ${JSON.stringify(ttl)} }\n`)).split("\n");
    expect(lines[0]).toBe("strategy.yaml: invalid auth-strategy descriptor:");
    expect(lines.slice(1)).toHaveLength(1);
    expect(lines[1]).toMatch(/^ {2}• roles\.editor\.cache\.ttl: /);
  });
});

describe("keys, records and the root", () => {
  it("names the role for an unknown key, and the cache for an unknown cache key", () => {
    expect(messageOf(role("    extra: 1\n"))).toMatch(/roles\.editor: Unrecognized key.*extra/);
    expect(messageOf(role("    cache: { enabled: true, extra: 1 }\n"))).toMatch(
      /roles\.editor\.cache: Unrecognized key.*extra/,
    );
  });

  it("names the key of a creds_env entry that is not a string", () => {
    expect(messageOf(role("    creds_env: { USER: 5 }\n"))).toContain(
      "  • roles.editor.creds_env.USER: Invalid input: expected string, received number",
    );
  });

  it("lists the strategies for one that does not exist", () => {
    const text = role().replace("manual-capture", "telepathy");
    const msg = messageOf(text);
    expect(msg).toContain("  • roles.editor.strategy: Invalid option: expected one of");
    expect(msg).toContain("manual-capture");
  });

  it("names default_role when it is not one of the roles", () => {
    const text = role().replace("default_role: editor", "default_role: admin");
    expect(messageOf(text)).toContain(
      "  • default_role: default_role must be one of the keys in roles",
    );
  });

  it("names the schema key for another schema id", () => {
    const text = role().replace("auth-strategy@1", "auth-strategy@2");
    const msg = messageOf(text);
    expect(msg).toContain("  • schema: Invalid input: expected");
    expect(msg).toContain("docsxai/auth-strategy@1");
  });

  it("names the root for a document that is not a mapping, and the file for broken YAML", () => {
    for (const text of ["", "- a\n", "just text\n"]) {
      expect(messageOf(text)).toContain("  • (root): Invalid input: expected object");
    }
    expect(messageOf("roles: [")).toMatch(/^strategy\.yaml: not valid YAML: /);
  });
});

describe("parseStrategyOptions", () => {
  const schema = z.object({ password: z.number(), mode: z.enum(["a", "b"]) }).strict();

  it("returns the parsed options", () => {
    expect(parseStrategyOptions("x", schema, { password: 1, mode: "a" })).toEqual({
      password: 1,
      mode: "a",
    });
  });

  it("names every bad key under options. and never prints a value", () => {
    try {
      parseStrategyOptions("x", schema, { password: "hunter2", mode: "hunter2", other: "hunter2" });
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthStrategyConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain("strategy `x`: invalid options:");
      expect(msg).toContain("  • options.password: Invalid input: expected number");
      expect(msg).toContain("  • options.mode: Invalid option: expected one of");
      expect(msg).toContain("other");
      expect(msg).not.toContain("hunter2");
    }
  });
});
