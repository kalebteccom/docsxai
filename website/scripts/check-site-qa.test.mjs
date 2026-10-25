// Static checks on src/styles/brand.css for the real-browser QA findings on the docs site: the
// rules that fixed them must stay. The browser re-run (scripts/layout-audit.mjs with
// website/layout-audit.json) measures the result; these checks need no build and no browser.
// Run with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
    assert.equal(valueOf(".sl-menu-button", "justify-content"), "center");
    assert.equal(valueOf(".sl-menu-button", "align-items"), "center");
    assert.equal(valueOf(".sl-menu-button", "padding"), "0");
  });
  it("uses the header palette, never a white disc", () => {
    const bg = valueOf(".sl-menu-button", "background-color") ?? "";
    assert.match(bg, /var\(--sl-color-bg-sidebar\)/);
    assert.match(valueOf(".sl-menu-button", "color") ?? "", /var\(--sl-color-white\)/);
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

describe("menu button open state (QA #6)", () => {
  it("follows Starlight's popover, not a removed aria-expanded attribute", () => {
    const bg = valueOf(".sl-menu-button:has(~ :popover-open)", "background-color") ?? "";
    assert.match(bg, /var\(--sl-color-accent-low\)/);
  });
});

describe("single column width (QA #5)", () => {
  it("lets the text column fill the width so both insets match", () => {
    assert.equal(valueOf(".sl-container", "max-width"), "none");
  });
});

describe("landing header on phones (QA #7)", () => {
  const bar = ":root:not([data-has-sidebar]) .header";
  it("keeps the theme switch and the GitHub link as 44 px buttons", () => {
    assert.equal(valueOf(`${bar} .right-group`, "display"), "flex");
    assert.equal(valueOf(`${bar} starlight-theme-select label`, "width"), "var(--docsx-tap)");
    assert.equal(valueOf(`${bar} starlight-theme-select label`, "height"), "var(--docsx-tap)");
    assert.equal(valueOf(`${bar} starlight-theme-select select`, "width"), "var(--docsx-tap)");
  });
});

describe("hero install box (QA #8)", () => {
  it("fills the column at one-column widths", () => {
    assert.match(css, /@media \(max-width: 52rem\)\s*\{\s*\.docsx-cmd--hero\s*\{\s*width: 100%;/);
  });
});

describe("touch targets (QA #9)", () => {
  it("grows the logo link to 44 px", () => {
    assert.equal(valueOf(".site-title", "min-height"), "var(--docsx-tap)");
  });
  it("pads heading anchors to a 44 px target that ends inside the heading box", () => {
    const link = ".sl-markdown-content .sl-anchor-link";
    assert.match(valueOf(link, "padding") ?? "", /^0\.75rem var\(--docsx-anchor-pad\)$/);
    assert.equal(valueOf(link, "margin-block"), "-0.75rem");
    // The end margin is 0: a negative one let the link's padding hang past the column and scrolled
    // the page sideways (QA round 2, N3).
    assert.match(valueOf(link, "margin-inline") ?? "", /\) 0$/);
    assert.doesNotMatch(valueOf(link, "margin-inline") ?? "", /-1rem/);
    assert.match(
      valueOf(".sl-markdown-content .sl-heading-wrapper", "--docsx-anchor-pad") ?? "",
      /var\(--docsx-tap\) - var\(--sl-anchor-icon-size\)/,
    );
  });
  it("reserves the target's padding at the end of the heading", () => {
    assert.match(
      valueOf(
        ".sl-markdown-content .sl-heading-wrapper > :first-child:not([hidden])",
        "padding-inline-end",
      ) ?? "",
      /var\(--sl-anchor-icon-space\) \+ var\(--docsx-anchor-pad\)/,
    );
  });
});

describe("hero transcript (QA #10)", () => {
  it("lets the result column shrink and wrap at every width", () => {
    assert.equal(valueOf(".docsx-snap .t-body", "white-space"), "normal");
    assert.match(valueOf(".docsx-snap .row", "grid-template-columns") ?? "", /minmax\(0, 1fr\)$/);
  });
});

describe("landscape phone chrome (QA #12)", () => {
  it("lets the sticky TOC bar scroll away", () => {
    assert.match(
      css,
      /@media \(max-width: 71\.99rem\) and \(max-height: 30rem\) and \(orientation: landscape\)\s*\{\s*mobile-starlight-toc nav\s*\{\s*position: absolute;/,
    );
  });
});

describe("palette (QA #13, #14)", () => {
  it("colours links in the landing's prose blocks with the accent text colour", () => {
    for (const sel of [".docsx-install-note a", ".docsx-lede a"]) {
      assert.equal(valueOf(sel, "color"), "var(--sl-color-text-accent)", sel);
    }
  });
  it("draws note asides in the ember palette", () => {
    assert.equal(
      valueOf(".starlight-aside--note", "--sl-color-asides-border"),
      "var(--sl-color-accent)",
    );
    assert.equal(
      valueOf(".starlight-aside--note", "background-color"),
      "var(--sl-color-accent-low)",
    );
  });
});

describe("code blocks wrap everywhere (QA round 2, N3)", () => {
  // Blocks that keep their columns and scroll instead. Each carries `wrap=false` on its fence and
  // is listed here by page and first line, so a new one is a decision in a diff.
  const NO_WRAP = [
    { page: "packages/backend.md", firstLine: "GitHub push/PR ──▶ POST /v1/github/webhook" },
  ];

  /** Every fence of every published page, as { page, info, firstLine }. */
  async function fences() {
    const { htmlPages, transformBody } = await import("./doc-pipeline.mjs");
    const pages = new Map();
    for (const p of htmlPages) pages.set(p.out, transformBody(p));
    const dir = join(site, "src", "content", "docs");
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      );
    for (const f of walk(dir)) {
      const rel = f.slice(dir.length + 1);
      if (/\.mdx?$/.test(rel) && !pages.has(rel)) pages.set(rel, readFileSync(f, "utf8"));
    }
    const out = [];
    for (const [page, body] of pages) {
      let open = false;
      const lines = body.split("\n");
      lines.forEach((line, i) => {
        if (!/^\s*```/.test(line)) return;
        if (!open) out.push({ page, info: line.trim().slice(3), firstLine: lines[i + 1] ?? "" });
        open = !open;
      });
    }
    return out;
  }

  it("turns wrapping and indent preservation on for every fence by default", async () => {
    const src = readFileSync(join(site, "astro.config.mjs"), "utf8");
    assert.match(src, /defaultProps:\s*\{\s*wrap:\s*true,\s*preserveIndent:\s*true\s*\}/);
    assert.doesNotMatch(src, /overridesByLang/);
  });

  it("lets only the listed fences opt out with wrap=false", async () => {
    const optOut = (await fences()).filter((f) => /\bwrap=false\b|\bwrap=\{false\}/.test(f.info));
    const listed = NO_WRAP.map((e) => e.page).sort();
    assert.deepEqual(optOut.map((f) => f.page).sort(), listed);
    for (const e of NO_WRAP) {
      const hit = optOut.find((f) => f.page === e.page);
      assert.ok(hit.firstLine.startsWith(e.firstLine), `${e.page} opt-out block changed`);
    }
  });

  it("breaks a long unbroken token inside a wrapped block", () => {
    assert.equal(
      valueOf(".sl-markdown-content .expressive-code pre.wrap .ec-line .code", "overflow-wrap"),
      "anywhere",
    );
    assert.equal(
      valueOf(".sl-markdown-content .expressive-code pre.wrap .ec-line .code", "min-width"),
      "0",
    );
  });
});

describe("paragraph measure at 721 to 799 px (QA round 2, N2)", () => {
  it("applies the 75 character cap only from the sidebar layout (50rem)", () => {
    assert.match(
      css,
      /@media \(min-width: 50rem\)\s*\{\s*\.sl-markdown-content :is\(p, li\):not\(:where\(\.not-content \*\)\)\s*\{\s*max-width: 75ch;/,
    );
    const bare = [...css.matchAll(/[^{}]*:is\(p, li\)[^{}]*\{[^{}]*max-width: 75ch/g)];
    assert.equal(bare.length, 1, "one 75ch rule, inside the media query");
  });
});
