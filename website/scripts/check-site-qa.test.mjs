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

/** A selector list split on the commas outside parentheses. */
function splitTopLevel(list) {
  const out = [""];
  let depth = 0;
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) out.push("");
    else out[out.length - 1] += ch;
  }
  return out;
}

/** Bodies of every rule whose selector list contains `selector` as one of its entries. */
function rulesFor(selector) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitTopLevel(m[1]).map((s) => s.trim().replace(/\s+/g, " "));
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

describe("docs tables on phones (QA #1)", () => {
  it("never breaks code in a cell mid-word", () => {
    assert.equal(valueOf(".sl-markdown-content table :not(pre) > code", "overflow-wrap"), "normal");
  });
  it("keeps a minimum width on the first column", () => {
    assert.match(
      valueOf(".sl-markdown-content table :is(th, td):first-child", "min-width") ?? "",
      /rem$/,
    );
  });
  it("stacks a wide table at phone width, cells labelled from data-label", () => {
    assert.match(
      css,
      /@media \(max-width: 48rem\)\s*\{\s*\.sl-markdown-content \.docsx-table-scroll > table\.docsx-table--stack/,
    );
    assert.equal(valueOf(".docsx-table--stack td::before", "content"), "attr(data-label)");
  });
});

describe("rehype-wrap-tables", () => {
  const el = (tagName, children = [], properties = {}) => ({
    type: "element",
    tagName,
    properties,
    children,
  });
  const txt = (value) => ({ type: "text", value });
  const table = (cols) =>
    el("table", [
      el("thead", [
        el(
          "tr",
          cols.map((c) => el("th", [txt(c)])),
        ),
      ]),
      el("tbody", [
        el(
          "tr",
          cols.map((c) => el("td", [el("code", [txt(`${c}-value`)])])),
        ),
      ]),
    ]);

  it("wraps every table and marks four or more columns for stacking", async () => {
    const { default: plugin } = await import("../plugins/rehype-wrap-tables.mjs");
    const tree = {
      type: "root",
      children: [table(["Key", "Type", "Default", "What it sets"]), table(["A", "B"])],
    };
    plugin()(tree);
    const [wide, narrow] = tree.children;
    assert.deepEqual(wide.properties.className, ["docsx-table-scroll"]);
    assert.deepEqual(narrow.properties.className, ["docsx-table-scroll"]);
    const t = wide.children[0];
    assert.deepEqual(t.properties.className, ["docsx-table--stack"]);
    assert.equal(t.properties.role, "table");
    const [thead, tbody] = t.children;
    assert.equal(thead.properties.role, "rowgroup");
    assert.equal(thead.children[0].children[0].properties.role, "columnheader");
    const cells = tbody.children[0].children;
    assert.equal(tbody.children[0].properties.role, "row");
    assert.deepEqual(
      cells.map((c) => [c.properties.role, c.properties.dataLabel]),
      [
        ["cell", "Key"],
        ["cell", "Type"],
        ["cell", "Default"],
        ["cell", "What it sets"],
      ],
    );
    assert.equal(narrow.children[0].properties.className, undefined);
    assert.equal(narrow.children[0].properties.role, undefined);
  });
});

describe("edge fade on sideways scrollers (QA #10, #11)", () => {
  it("masks tables, code blocks and the hero transcript from a scroll timeline", () => {
    const m = css.match(/@supports \(animation-timeline: scroll\(\)\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, "the @supports block exists");
    for (const sel of [".docsx-table-scroll", ".expressive-code pre", ".docsx-snap"]) {
      assert.ok(m[1].includes(sel), `${sel} is faded`);
    }
    assert.match(m[1], /animation-timeline: scroll\(self inline\)/);
    assert.match(m[1], /mask-image: linear-gradient\(/);
  });
  it("keeps the table focus ring inside the mask", () => {
    assert.match(valueOf(".docsx-table-scroll:focus-visible", "outline-offset") ?? "", /^-/);
  });
});

describe("menu button (QA #2, #6)", () => {
  it("centres its icon in the 44 px circle", () => {
    assert.equal(valueOf("starlight-menu-button button", "justify-content"), "center");
    assert.equal(valueOf("starlight-menu-button button", "align-items"), "center");
    assert.equal(valueOf("starlight-menu-button button", "padding"), "0");
  });
  it("uses the header palette, never a white disc", () => {
    const bg = valueOf("starlight-menu-button button", "background-color") ?? "";
    assert.match(bg, /var\(--sl-color-bg-sidebar\)/);
    assert.match(valueOf("starlight-menu-button button", "color") ?? "", /var\(--sl-color-white\)/);
  });
});

describe("CLI reference code blocks (QA #4)", () => {
  it("wraps every usage and output block instead of scrolling 2000 px sideways", () => {
    const md = readFileSync(join(site, "src", "content", "docs", "reference", "cli.md"), "utf8");
    let open = false;
    const bare = [];
    md.split("\n").forEach((line, i) => {
      if (!line.startsWith("```")) return;
      if (!open && !/^```json\b/.test(line) && !/\bwrap\b/.test(line)) bare.push(i + 1);
      open = !open;
    });
    assert.deepEqual(bare, [], `fences without wrap at lines ${bare.join(", ")}`);
  });
});
