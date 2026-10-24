// Static checks on src/styles/brand.css for the real-browser QA findings on the docs site: the
// rules that fixed them must stay. The browser re-run (scripts/layout-audit.mjs with
// website/layout-audit.json) measures the result; these checks need no build and no browser.
// Run with `node --test` (the package's `test` script).
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

/** Bodies of every rule whose selector list contains `selector` as one of its entries. */
function rulesFor(selector) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out;
}

/** The value of `prop` in any rule for `selector`, or undefined. */
function valueOf(selector, prop) {
  for (const body of rulesFor(selector)) {
    const m = body.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`));
    if (m) return m[1].trim();
  }
  return undefined;
}

describe("frosted header (QA #3)", () => {
  it("writes backdrop-filter unprefixed only, so the minifier keeps both", () => {
    assert.doesNotMatch(css, /[{;]\s*-webkit-backdrop-filter\s*:/);
  });
  it("blurs the header and the sticky TOC bar", () => {
    assert.match(valueOf(".header", "backdrop-filter") ?? "", /blur\(/);
    assert.match(valueOf("mobile-starlight-toc nav", "backdrop-filter") ?? "", /blur\(/);
  });
  it("goes opaque where backdrop-filter is unsupported", () => {
    assert.match(
      css,
      /@supports not \(\(backdrop-filter: blur\(1px\)\)[^{]*\{[^}]*--sl-color-bg-nav:\s*var\(--sl-color-bg\)/,
    );
  });
});
