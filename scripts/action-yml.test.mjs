// Guards the drift-gate action.yml at the repo root. Text checks only: no YAML parser at the root.
// Run with `node --test scripts/action-yml.test.mjs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const text = readFileSync(new URL("../action.yml", import.meta.url), "utf8");

describe("action.yml", () => {
  it("is a composite action with the documented inputs", () => {
    assert.match(text, /using: composite/);
    for (const name of ["workspace", "version", "base-url", "baseline", "fail-on", "comment"]) {
      assert.match(text, new RegExp(`^ {2}${name}:`, "m"), `input ${name}`);
    }
  });
  it("never interpolates inputs or event data straight into a shell script", () => {
    const blocks = text.split(/^ {6}run: /m).slice(1);
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      const script = block.split(/\n {4}- /)[0];
      assert.doesNotMatch(script, /\$\{\{/, `run block interpolates an expression:\n${script}`);
    }
  });
  it("installs the version the caller names", () => {
    assert.match(text, /DOCSXAI_VERSION: \$\{\{ inputs\.version \}\}/);
  });
});
