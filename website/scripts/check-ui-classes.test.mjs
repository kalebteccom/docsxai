// Guards the class-level findings of the rendered UI pass in website/src/styles/brand.css. Each
// test names a class of defect and fails when a new instance appears. No build, no browser. Run
// with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(site, "..");
const cssPath = join(site, "src", "styles", "brand.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `selector { body }` pair, at-rule wrappers ignored. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean),
  body: m[2],
}));
const declarations = (body) =>
  body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]);
const rulesFor = (pred) => rules.filter((r) => r.selectors.some(pred));

describe("transitions animate paint properties only", () => {
  // Layout properties make every frame a reflow. Transform and opacity run on the compositor;
  // colour properties are cheap and never move a box.
  const OK = new Set([
    "transform",
    "opacity",
    "color",
    "background",
    "background-color",
    "border-color",
    "text-decoration-color",
    "outline-color",
    "fill",
    "stroke",
  ]);
  it("lists no layout property and no `all`", () => {
    const bad = [];
    for (const r of rules)
      for (const [prop, value] of declarations(r.body)) {
        if (prop !== "transition" && prop !== "transition-property") continue;
        if (/^none\b/.test(value)) continue;
        const props = value
          .split(/,(?![^(]*\))/)
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean);
        for (const p of props) if (!OK.has(p)) bad.push(`${r.selectors[0]}: ${p}`);
      }
    assert.deepEqual(bad, []);
  });
});

describe("hand-built controls have every state", () => {
  // Each hand-built control: the states it must style. A link has no :disabled.
  const CONTROLS = {
    ".docsx-btn": [":hover", ":active", ":focus-visible", ":disabled"],
    ".docsx-copy": [":hover", ":active", ":focus-visible", ":disabled"],
    ".docsx-sidebar-llms": [":hover", ":focus-visible"],
    ".docsx-credit a": [":hover", ":focus-visible"],
  };
  for (const [control, states] of Object.entries(CONTROLS))
    for (const state of states)
      it(`${control} styles ${state}`, () => {
        const hit = rulesFor((s) => s.startsWith(control) && s.includes(state));
        assert.ok(hit.length > 0, `no ${state} rule for ${control}`);
      });
});

describe("headings", () => {
  it("balance their wrap at h1 to h6", () => {
    const balanced = rulesFor(() => true)
      .filter((r) => /text-wrap:\s*balance/.test(r.body))
      .flatMap((r) => r.selectors);
    for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"])
      assert.ok(balanced.includes(h), `${h} has no text-wrap: balance`);
  });
});

describe("spacing", () => {
  // The scale: multiples of 0.25rem (4px), plus 0.125rem and hairlines up to 2px. Percentages,
  // viewport units, em, `auto` and clamp()/max() arguments are fluid and not checked.
  const PROPS =
    /^(padding|margin|gap|row-gap|column-gap|inset)(-(top|bottom|left|right|block|inline)(-(start|end))?)?$/;
  const EXCEPTIONS = new Map([
    // selector fragment -> reason
  ]);
  it("keeps padding, margin, gap and inset on the scale", () => {
    const bad = [];
    for (const r of rules)
      for (const [prop, value] of declarations(r.body)) {
        if (!PROPS.test(prop) && !/^inset/.test(prop)) continue;
        if (EXCEPTIONS.has(r.selectors[0])) continue;
        for (const m of value.matchAll(/(-?[\d.]+)(rem|px)\b/g)) {
          const n = Math.abs(parseFloat(m[1]));
          const ok =
            n === 0 ||
            (m[2] === "rem" && (Math.abs(n * 4 - Math.round(n * 4)) < 1e-9 || n === 0.125)) ||
            (m[2] === "px" && (n <= 2 || n % 4 === 0));
          if (!ok) bad.push(`${r.selectors[0]} { ${prop}: ${value} }`);
        }
      }
    assert.deepEqual(bad, []);
  });
});

describe("measure", () => {
  it("caps no max-width in ch above 75", () => {
    const bad = [];
    for (const r of rules)
      for (const [prop, value] of declarations(r.body))
        if (/^max-width$/.test(prop))
          for (const m of value.matchAll(/([\d.]+)ch\b/g))
            if (parseFloat(m[1]) > 75) bad.push(`${r.selectors[0]}: ${value}`);
    assert.deepEqual(bad, []);
  });
});

describe("dark surfaces set their own text colour", () => {
  // A rule that paints a solid fill from a brand token must set `color` in the same rule, or the
  // text inherits a colour picked for another surface. Fills that mix toward transparent or point
  // at the page background inherit the page's text colour on purpose.
  const SOLID = /^var\(--docsx-(amber|gold|halo)[a-z0-9-]*\)$|^#[0-9a-f]{3,8}$/i;
  const EXCEPTIONS = new Map();
  it("pairs every solid brand fill with a colour", () => {
    let checked = 0;
    const bad = [];
    for (const r of rules) {
      if (EXCEPTIONS.has(r.selectors[0])) continue;
      const decl = declarations(r.body);
      const fill = decl.find(([p, v]) => /^background(-color)?$/.test(p) && SOLID.test(v));
      if (!fill) continue;
      checked++;
      if (/^(body|:root)/.test(r.selectors[0])) continue;
      if (/:(hover|active|focus-visible|disabled)/.test(r.selectors.join(","))) continue;
      if (!decl.some(([p]) => p === "color")) bad.push(`${r.selectors[0]} { ${fill.join(": ")} }`);
    }
    assert.ok(checked > 0, "no solid fills found, the pattern is stale");
    assert.deepEqual(bad, []);
  });
});

describe("skip and brand links have a hit area", () => {
  it("sizes the focused skip link to the tap minimum", () => {
    const r = rulesFor((s) => s === ".sl-skip-link:focus");
    assert.ok(r.length, "no .sl-skip-link:focus rule");
    assert.match(r[0].body, /min-height:\s*var\(--docsx-tap/);
  });
  it("gives the footer credit links 24px on a pointer and the tap minimum on touch", () => {
    const base = rulesFor((s) => s === ".docsx-credit a")[0];
    assert.match(base.body, /min-height:\s*1\.5rem/);
    const touch = rulesFor((s) => s === ".docsx-credit a").find((r) =>
      /var\(--docsx-tap\)/.test(r.body),
    );
    assert.ok(touch, "no touch min-height for .docsx-credit a");
  });
  it("hides the middot separators from assistive tech", () => {
    const footer = readFileSync(join(site, "src", "components", "Footer.astro"), "utf8");
    for (const m of footer.matchAll(/<span class="sep"([^>]*)>/g))
      assert.match(m[1], /aria-hidden="true"/);
  });
});

describe("no dead brand selectors", () => {
  // A class selector in brand.css must appear somewhere that can render it: the site's pages and
  // components, the rehype plugins, the docs, or a package source. A `prefix--${x}` template counts
  // for every `prefix--*` class. Classes owned by Starlight and Expressive Code are exempt.
  const EXTERNAL =
    /^(sl-|starlight|ec-|expressive-code|content-panel|site-title|group-label|label-icon|pagination-links|right-|sidebar-pane|social-icons|top-level|not-content|copy$|frame$|header$|title$|meta$|hero$)/;
  const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".git", "coverage"]);
  function walk(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(astro|mdx?|mjs|ts|tsx|html|js)$/.test(e.name) && p !== cssPath) out.push(p);
    }
    return out;
  }
  const corpusDirs = [
    join(site, "src"),
    join(site, "plugins"),
    join(root, "docs"),
    ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "src")),
  ];
  const corpus =
    corpusDirs
      .flatMap((d) => walk(d))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n") + readFileSync(join(site, "astro.config.mjs"), "utf8");
  it("finds every docsx class in a renderer", () => {
    const classes = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const dead = [];
    for (const c of classes) {
      if (EXTERNAL.test(c) || !/^(docsx|dxm|dxf|dxb|dxs)/.test(c)) continue;
      if (corpus.includes(c)) continue;
      const mod = c.indexOf("--");
      if (mod > 0 && corpus.includes(`${c.slice(0, mod)}--\${`)) continue;
      dead.push(c);
    }
    assert.deepEqual(dead, [], `dead selectors in ${relative(root, cssPath)}`);
  });
});
