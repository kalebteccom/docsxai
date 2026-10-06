// The deprecation helper: the message shape the policy promises, warn-once per item, the lookup
// that keeps prototype names out of a registry, and the one real use (the retired `drift` command).

import { beforeEach, describe, expect, it } from "vitest";
import { RETIRED_COMMANDS } from "../src/cli-retired.js";
import {
  deprecationMessage,
  findRetired,
  resetDeprecationWarnings,
  warnDeprecated,
} from "../src/deprecation.js";

beforeEach(() => resetDeprecationWarnings());

describe("deprecationMessage", () => {
  it("names the item, the release and the replacement", () => {
    expect(deprecationMessage("--old", { since: "0.3.0", replacement: "--new" })).toBe(
      "docsxai: --old is deprecated since 0.3.0, use --new",
    );
  });

  it("leaves the replacement out when there is none, and adds a note in parentheses", () => {
    expect(deprecationMessage("field x", { since: "1.2.0" })).toBe(
      "docsxai: field x is deprecated since 1.2.0",
    );
    expect(
      deprecationMessage("field x", { since: "1.2.0", replacement: "y", note: "renamed" }),
    ).toBe("docsxai: field x is deprecated since 1.2.0, use y (renamed)");
  });
});

describe("warnDeprecated", () => {
  it("writes the line once per item and reports whether it wrote", () => {
    const lines: string[] = [];
    const write = (line: string) => void lines.push(line);
    const entry = { since: "0.3.0", replacement: "--new" };
    expect(warnDeprecated("--old", entry, write)).toBe(true);
    expect(warnDeprecated("--old", entry, write)).toBe(false);
    expect(warnDeprecated("--other", entry, write)).toBe(true);
    expect(lines).toEqual([
      "docsxai: --old is deprecated since 0.3.0, use --new\n",
      "docsxai: --other is deprecated since 0.3.0, use --new\n",
    ]);
  });

  it("warns again after a reset", () => {
    const lines: string[] = [];
    const write = (line: string) => void lines.push(line);
    warnDeprecated("--old", { since: "0.3.0" }, write);
    resetDeprecationWarnings();
    warnDeprecated("--old", { since: "0.3.0" }, write);
    expect(lines).toHaveLength(2);
  });
});

describe("findRetired", () => {
  const registry = { old: { since: "0.3.0", replacement: "new" } };

  it("finds an own key", () => {
    expect(findRetired(registry, "old")).toEqual({ since: "0.3.0", replacement: "new" });
  });

  it("does not find an unknown name or a prototype name", () => {
    expect(findRetired(registry, "unknown")).toBeUndefined();
    expect(findRetired(registry, "constructor")).toBeUndefined();
    expect(findRetired(registry, "toString")).toBeUndefined();
  });
});

describe("RETIRED_COMMANDS", () => {
  it("retires drift in favour of pack --check, keeping the arguments", () => {
    const drift = findRetired(RETIRED_COMMANDS, "drift")!;
    expect(drift.rewrite(["ws", "--against", "p"])).toEqual([
      "pack",
      "ws",
      "--against",
      "p",
      "--check",
    ]);
    expect(deprecationMessage("the drift command", drift)).toBe(
      "docsxai: the drift command is deprecated since 0.3.0, use `docsxai pack --check` (same flags, `--check` added)",
    );
  });
});
