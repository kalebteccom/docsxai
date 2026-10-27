// Guards docs/design-audit-allowlist.md: one table with the columns rule, count, reason and
// evidence, and every entry has a numeric count, a reason and evidence. The list is only for
// detector noise, so an entry without evidence is rejected. No build, no browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const doc = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "design-audit-allowlist.md",
);
const COLUMNS = ["rule", "count", "reason", "evidence"];

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** Parse the markdown tables in a document into { header, rows }. */
export function tables(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue;
    const header = cells(lines[i]).map((h) => h.toLowerCase());
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) rows.push(cells(lines[j++]));
    out.push({ header, rows });
    i = j;
  }
  return out;
}

describe("design audit allowlist", () => {
  const text = readFileSync(doc, "utf8");
  const found = tables(text);

  it("has exactly one table with the columns rule, count, reason, evidence", () => {
    assert.equal(found.length, 1, "one table only");
    assert.deepEqual(found[0].header, COLUMNS);
  });

  it("names the tool, its version and how to re-run it", () => {
    assert.match(text, /impeccable 4\.\d+\.\d+/);
    assert.match(text, /detect --json/);
    assert.match(text, /sandbox/i);
  });

  it("gives every entry a rule, a numeric count, a reason and evidence", () => {
    for (const row of found[0].rows) {
      assert.equal(row.length, COLUMNS.length, `row has ${COLUMNS.length} cells: ${row[0]}`);
      const [rule, count, reason, evidence] = row;
      assert.ok(rule, "rule is set");
      assert.match(count, /^\d+$/, `count of "${rule}" is a number`);
      assert.ok(reason.length >= 20, `"${rule}" has a reason`);
      assert.ok(evidence.length >= 20, `"${rule}" has evidence`);
    }
  });
});
