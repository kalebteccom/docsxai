// Checks the site-wide scrollbar rules in src/styles/brand.css: the three tokens in both themes,
// the standard properties, the webkit fallback for browsers without scrollbar-color, the
// high-contrast reset, no hidden scrollbars, and a thumb of at least 3:1 against the page and
// sidebar backgrounds. Run with `node --test` (the package's `test` script); no build needed.
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
const config = readFileSync(join(site, "astro.config.mjs"), "utf8");

// Starlight's --sl-color-white per theme (style/props.css): hsl(0, 0%, 100%) in dark,
// hsl(224, 10%, 10%) in light. brand.css does not override it.
const INK = { dark: [255, 255, 255], light: [22.95, 24.31, 28.05] };

/** Body of every rule whose selector list is exactly `selector`. */
function blocks(selector) {
  const out = [];
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const re = new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^{}]*)\\}`, "g");
  for (const m of css.matchAll(re)) out.push(m[1]);
  return out;
}
const DARK = ':root,\n:root[data-theme="dark"]';
const LIGHT = ':root[data-theme="light"]';

function declared(body, prop) {
  const m = body.match(new RegExp(`${prop}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}
function themeValue(selector, prop) {
  for (const b of blocks(selector)) {
    const v = declared(b, prop);
    if (v) return v;
  }
  return undefined;
}

function hex(s) {
  const n = s.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `fg` at `alpha` composited over the opaque `bg`. */
function over(fg, bg, alpha) {
  return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]);
}
function alphaOf(token) {
  const m = token?.match(/^color-mix\(in srgb, var\(--sl-color-white\) (\d+)%, transparent\)$/);
  assert.ok(m, `unexpected token shape: ${token}`);
  return Number(m[1]) / 100;
}

describe("scrollbar tokens", () => {
  for (const [theme, selector] of [
    ["dark", DARK],
    ["light", LIGHT],
  ]) {
    it(`defines the three tokens for the ${theme} theme`, () => {
      assert.equal(themeValue(selector, "--scrollbar-track"), "transparent");
      assert.equal(alphaOf(themeValue(selector, "--scrollbar-thumb")), 0.5);
      assert.equal(alphaOf(themeValue(selector, "--scrollbar-thumb-hover")), 0.7);
    });

    it(`gives the ${theme} thumb at least 3:1 against the page and sidebar`, () => {
      const alpha = alphaOf(themeValue(selector, "--scrollbar-thumb"));
      for (const surface of ["--sl-color-bg", "--sl-color-bg-sidebar"]) {
        const bg = hex(themeValue(selector, surface));
        const ratio = contrast(over(INK[theme], bg, alpha), bg);
        assert.ok(ratio >= 3, `${theme} thumb on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
});

describe("scrollbar rules", () => {
  it("sets the standard properties on the root and every element", () => {
    const [body] = blocks(":root,\n*");
    assert.ok(body, "no `:root, *` rule");
    assert.equal(declared(body, "scrollbar-width"), "thin");
    assert.equal(
      declared(body, "scrollbar-color"),
      "var(--scrollbar-thumb) var(--scrollbar-track)",
    );
  });

  it("falls back to a 12px webkit scrollbar where scrollbar-color is unsupported", () => {
    const start = css.indexOf("@supports not (scrollbar-color: auto)");
    assert.ok(start >= 0, "no @supports fallback");
    const fallback = css.slice(start, css.indexOf("@media", start));
    assert.match(fallback, /\*\s*\{\s*scrollbar-width: auto;\s*\}/);
    assert.match(fallback, /::-webkit-scrollbar\s*\{\s*width: 12px;\s*height: 12px;\s*\}/);
    assert.match(
      fallback,
      /::-webkit-scrollbar-track\s*\{\s*background: var\(--scrollbar-track\);/,
    );
    assert.match(
      fallback,
      /::-webkit-scrollbar-thumb\s*\{\s*background: var\(--scrollbar-thumb\);\s*border: 3px solid transparent;\s*background-clip: content-box;\s*border-radius: 6px;/,
    );
    assert.match(
      fallback,
      /::-webkit-scrollbar-thumb:hover\s*\{\s*background: var\(--scrollbar-thumb-hover\);\s*background-clip: content-box;/,
    );
  });

  it("hands the scrollbar back to the system under forced colours or more contrast", () => {
    assert.match(
      css,
      /@media \(forced-colors: active\), \(prefers-contrast: more\) \{\s*:root,\s*\*\s*\{\s*scrollbar-width: auto;\s*scrollbar-color: auto;\s*\}\s*\}/,
    );
  });

  it("never hides a scrollbar", () => {
    assert.doesNotMatch(css, /scrollbar-width:\s*none/);
    assert.doesNotMatch(css, /::-webkit-scrollbar[\w-]*(?::[\w-]+)?\s*\{[^}]*display:\s*none/);
  });

  it("keeps Expressive Code from styling code-block scrollbars itself", () => {
    assert.match(config, /useThemedScrollbars: false/);
  });
});
