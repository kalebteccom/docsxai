// Checks the doc-porting pipeline: every `replace` rule still matches its source (a stale pattern
// silently publishes the text it was meant to strip), and no published page carries internal
// planning pointers or release-milestone wording. Run with `node --test` (the package's `test`
// script).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { agentOnlyPages, htmlPages, ROOT, transformBody } from "./doc-pipeline.mjs";

const pages = [...htmlPages, ...agentOnlyPages];

describe("doc pipeline replace rules", () => {
  for (const page of pages) {
    for (const [re] of page.replace ?? []) {
      it(`${page.src}: ${re} matches the source`, () => {
        assert.match(readFileSync(join(ROOT, page.src), "utf8"), re);
      });
    }
  }
});

describe("published pages carry no internal planning wording", () => {
  const banned = [/PHASE-\d/, /public flip/i, /go-public/i, /decided at the/i];
  for (const page of pages) {
    it(page.src, () => {
      const body = transformBody(page);
      for (const re of banned) assert.doesNotMatch(body, re);
    });
  }
});
