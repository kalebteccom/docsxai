// Checks the landing page's copy button (src/components/CopyCommand.astro and its rules in
// src/styles/brand.css): every label sits in one grid cell and only its visibility changes, so the
// button keeps its box in the idle, copied and manual states, and a click while a copy is pending
// does nothing. Run with `node --test`; no build needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(site, "src", "styles", "brand.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const astro = readFileSync(join(site, "src", "components", "CopyCommand.astro"), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("CopyCommand keeps its box across states", () => {
  it("ships one label per state inside the button", () => {
    for (const label of ["docsx-copy-idle", "docsx-copy-done", "docsx-copy-manual"])
      assert.match(astro, new RegExp(`<span class="${label}" aria-hidden="true">`));
  });

  it("stacks the labels in one grid cell", () => {
    assert.match(rule(".docsx-copy"), /display: inline-grid;/);
    assert.match(rule(".docsx-copy > span"), /grid-area: 1 \/ 1;/);
  });

  it("switches labels by visibility only", () => {
    const states = css.match(/\.docsx-copy[^{]*\{[^}]*\}/g) ?? [];
    for (const block of states) assert.doesNotMatch(block, /display: none|content:/);
    assert.match(
      css,
      /\.docsx-copy\[data-state="manual"\] \.docsx-copy-manual \{\s*visibility: visible;/,
    );
  });

  it("never rewrites a label's text on click", () => {
    const click = astro.slice(astro.indexOf("async function onClick"));
    assert.doesNotMatch(click.slice(0, click.indexOf("\n  }\n")), /textContent = (?!"")/);
  });
});

describe("CopyCommand runs one copy at a time", () => {
  it("ignores a click while a copy is pending and clears the flag when it settles", () => {
    assert.match(astro, /if \(button\.getAttribute\("aria-busy"\) === "true"\) return;/);
    const set = astro.indexOf('button.setAttribute("aria-busy", "true")');
    const write = astro.indexOf("navigator.clipboard.writeText");
    const clear = astro.indexOf('button.removeAttribute("aria-busy")');
    assert.ok(
      set >= 0 && set < write && write < clear,
      "busy is set before the write and cleared after it",
    );
  });
});
