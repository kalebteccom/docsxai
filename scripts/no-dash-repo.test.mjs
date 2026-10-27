// Fails when an em dash (U+2014) or an en dash (U+2013) appears in any tracked text file
// outside EXCEPTIONS. Covers source comments, tests, config, fixtures and docs alike.
// Run with `node --test` (the website package's `test` script runs it).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = /[\u2013\u2014]/;

/**
 * Paths that may keep a dash. Each needs a reason. `prefix` entries match a path prefix,
 * `path` entries match one file exactly.
 */
export const EXCEPTIONS = [
  {
    path: ".claude/hooks/block-forbidden-commands.sh",
    reason:
      "Agent hook with a hash-guarded edit path; owned by the agent tooling, not this repo's copy.",
  },
  { prefix: ".woodpecker/", reason: "CI definitions are hash-guarded and not edited here." },
  { prefix: ".claude/settings", reason: "Agent settings are not edited here." },
  { path: "THIRD_PARTY_NOTICES.md", reason: "Verbatim third-party licence text." },
];

function excepted(rel) {
  return EXCEPTIONS.some((x) => (x.path ? x.path === rel : rel.startsWith(x.prefix)));
}

/** Lines with a dash in `text`, as `path:line: snippet`. */
export function dashLines(rel, text) {
  if (excepted(rel) || text.includes("\0")) return [];
  const found = [];
  text.split("\n").forEach((line, i) => {
    if (DASH.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return found;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

describe("no em or en dashes anywhere in the repo", () => {
  it("keeps every exception justified", () => {
    for (const x of EXCEPTIONS) assert.ok((x.path || x.prefix) && x.reason, JSON.stringify(x));
  });

  it("flags a planted dash, skips binary text and excepted paths", () => {
    assert.equal(dashLines("a.ts", "// a \u2014 b\n").length, 1);
    assert.equal(dashLines("a.ts", "// 1\u20135\n").length, 1);
    assert.equal(dashLines("a.ts", "// plain\n").length, 0);
    assert.equal(dashLines("a.bin", "a\0\u2014").length, 0);
    assert.equal(dashLines(".woodpecker/x.yml", "\u2014").length, 0);
  });

  it("finds none in any tracked text file", () => {
    const bad = trackedFiles().flatMap((rel) => {
      let text;
      try {
        text = readFileSync(join(repo, rel), "utf8");
      } catch {
        return [];
      }
      return dashLines(rel, text);
    });
    assert.deepEqual(bad, [], `Rewrite with a comma, colon or full stop:\n${bad.join("\n")}`);
  });
});
