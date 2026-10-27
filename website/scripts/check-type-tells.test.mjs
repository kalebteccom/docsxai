// Guards the site's type and surface tells. Monospace is for code only. No grid backgrounds, glows,
// blurred shadows, side-stripe borders, wide tracking, uppercase labels, Inter or pure black and
// white in the stylesheet. Reads website/src (CSS, Astro, MDX, Markdown) and astro.config.mjs; no
// build and no browser. Run with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(site, "src");

/**
 * Selectors that may use the mono face without being code by name. Each one shows code: a command
 * snippet, a terminal transcript or a flow file's own lines. Nothing else is allowed.
 */
const MONO_OK = new Map([
  [".docsx-cmd", "install and init command snippets with a prompt and a copy button"],
  [".docsx-snap", "terminal transcript of docsxai commands and their output"],
  [".dxf-flow-name", "file name of the flow file shown in the flow-file excerpt"],
]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(css|astro|mdx?|mjs|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(src);
const read = (p) => readFileSync(p, "utf8");
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
const brand = stripComments(read(join(src, "styles", "brand.css")));
const config = read(join(site, "astro.config.mjs"));

/** Every `selector { body }` pair, with at-rule wrappers ignored. */
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    out.push({ selectors, body: m[2] });
  }
  return out;
}

/** Top-level comma split, so `color-mix(in srgb, a, b)` stays whole. */
function splitTop(value) {
  const parts = [""];
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += ch;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

const isCodeSelector = (sel) => /(^|[\s>+~.#:[])(code|pre|kbd|samp)\b/.test(sel);

describe("monospace is for code", () => {
  it("uses the mono family only on code selectors and the listed command panes", () => {
    const bad = [];
    for (const { selectors, body } of rules(brand)) {
      const usesMono = /--docsx-font-mono|--sl-font-mono|monospace|JetBrains Mono/i.test(body);
      if (!usesMono) continue;
      // The token definitions themselves.
      if (selectors.every((s) => s === ":root")) continue;
      for (const sel of selectors) {
        if (!isCodeSelector(sel) && !MONO_OK.has(sel)) bad.push(sel);
      }
    }
    assert.deepEqual(bad, [], `mono face on non-code selectors: ${bad.join(" | ")}`);
  });
  it("keeps every exception in use, so the list cannot go stale", () => {
    for (const sel of MONO_OK.keys()) {
      const hit = rules(brand).some(
        (r) => r.selectors.includes(sel) && /--docsx-font-mono/.test(r.body),
      );
      assert.ok(hit, `${sel} no longer uses mono; remove it from MONO_OK`);
    }
  });
  it("sets no mono family in Astro, MDX or Markdown", () => {
    const bad = files
      .filter((p) => /\.(astro|mdx?)$/.test(p))
      .filter((p) => /font-family\s*:[^;"]*(mono|monospace)|--docsx-font-mono/i.test(read(p)))
      .map((p) => relative(site, p));
    assert.deepEqual(bad, []);
  });
  it("loads JetBrains Mono for code blocks only, through expressiveCode and the token", () => {
    assert.match(config, /codeFontFamily:\s*"var\(--docsx-font-mono\)"/);
  });
});

describe("no uppercase labels or wide tracking", () => {
  it("sets no text-transform: uppercase", () => {
    assert.doesNotMatch(brand, /text-transform\s*:\s*uppercase/);
  });
  it("sets no positive letter-spacing", () => {
    const bad = [...brand.matchAll(/letter-spacing\s*:\s*([^;}]+)/g)]
      .map((m) => m[1].trim())
      .filter((v) => !/^(normal|0|-)/.test(v));
    assert.deepEqual(bad, []);
  });
  it("builds no card mark from a code-comment prefix", () => {
    const bad = files
      .filter((p) => /\.(astro|mdx?)$/.test(p))
      .filter((p) => /class="[^"]*(kicker|card-mark|eyebrow)[^"]*">\s*\/\//.test(read(p)))
      .map((p) => relative(site, p));
    assert.deepEqual(bad, []);
  });
});

describe("no grid, glow, blurred shadow or side stripe", () => {
  it("draws no grid-line gradient and keeps no grid or glow token", () => {
    assert.doesNotMatch(brand, /linear-gradient\([^)]*\b1px,\s*transparent\s+1px\)/);
    assert.doesNotMatch(brand, /--docsx-(grid-line|glow)/);
    assert.doesNotMatch(brand, /background-size\s*:\s*\d+px\s+\d+px/);
  });
  it("uses radial-gradient only inside a mask", () => {
    const bad = [...brand.matchAll(/([a-z-]+)\s*:[^;{}]*radial-gradient/g)]
      .map((m) => m[1])
      .filter((prop) => !/^(-webkit-)?mask(-image)?$/.test(prop));
    assert.deepEqual(bad, []);
  });
  it("blurs nothing with filter or text-shadow", () => {
    assert.doesNotMatch(brand, /[{;\s]filter\s*:/);
    assert.doesNotMatch(brand, /drop-shadow\(|text-shadow\s*:/);
  });
  it("sets only crisp box-shadows (zero blur): no glow, no drop shadow", () => {
    const bad = [];
    for (const m of brand.matchAll(/(?:^|[;{\s])box-shadow\s*:\s*([^;}]+)/g)) {
      const value = m[1].trim();
      if (value === "none") continue;
      for (const layer of splitTop(value)) {
        const lengths = layer
          .replace(/color-mix\([^)]*(\([^)]*\)[^)]*)*\)/g, "")
          .match(/-?\d*\.?\d+(?:px|rem|em)?(?=\s|$)/g);
        const blur = lengths?.[2];
        if (blur !== undefined && parseFloat(blur) !== 0) bad.push(layer);
      }
    }
    assert.deepEqual(bad, []);
  });
  it("draws no solid border-left or border-inline-start wider than 1px (a dashed divider rail is not a card stripe)", () => {
    const bad = [...brand.matchAll(/border-(?:left|right|inline-start|inline-end)\s*:\s*([^;}]+)/g)]
      .map((m) => m[1].trim())
      .filter((v) => !/^(0|none)\b/.test(v) && !/^1px\b/.test(v) && !/\bdashed\b/.test(v));
    assert.deepEqual(bad, []);
  });
});

describe("one body face, no pure black or white", () => {
  it("does not load or name Inter on the site", () => {
    assert.doesNotMatch(config, /fontsource\/inter/);
    assert.doesNotMatch(brand, /\bInter\b/);
  });
  it("loads each font file the stylesheet names, and no other", () => {
    const loaded = [...config.matchAll(/@fontsource\/([a-z-]+)\//g)].map((m) => m[1]);
    assert.deepEqual([...new Set(loaded)].sort(), ["jetbrains-mono", "poppins"]);
  });
  it("uses no #000, #fff or rgba(0, 0, 0) in the stylesheet", () => {
    assert.doesNotMatch(brand, /#(?:000|fff)(?:000|fff)?\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\b/i);
  });
  it("balances every heading level", () => {
    for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const hit = rules(brand).some(
        (r) => r.selectors.includes(h) && /text-wrap\s*:\s*balance/.test(r.body),
      );
      assert.ok(hit, `${h} has no text-wrap: balance`);
    }
  });
});
