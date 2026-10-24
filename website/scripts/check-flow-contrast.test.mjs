// WCAG contrast of the text inside the hero flow diagram (.dxf-flow) in both themes, computed from
// the custom properties in src/styles/brand.css and Starlight's grays. Normal text needs 4.5:1.
// The panel is --docsx-glass over --sl-color-bg; the ember glow behind it is not modelled. A
// `.muted` line is drawn with `opacity`, so its text colour is blended into the panel first.
// Run with `node --test` (the package's `test` script); no build needed.
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

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hsl = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
};
const mix = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** A `--name: #hex;` declaration inside the rule whose selector list starts with `selector`. */
function token(selector, name) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `rule ${selector} exists`);
  const body = css.slice(at, css.indexOf("}", at));
  const m = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `${name} is a hex in ${selector}`);
  return hex(m[1]);
}
const amber = (n) => {
  const m = css.match(new RegExp(`--docsx-amber-${n}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--docsx-amber-${n}`);
  return hex(m[1]);
};

// Starlight props.css: gray-2 per theme. Glass: white at 5% (dark), 60% (light) over the page.
const THEMES = {
  dark: {
    bg: token(':root[data-theme="dark"]', "--sl-color-bg"),
    glass: 0.05,
    glassTint: [255, 255, 255],
    gray2: hsl(224, 6, 77),
    accent: amber(300),
  },
  light: {
    bg: token(':root[data-theme="light"]', "--sl-color-bg"),
    glass: 0.6,
    glassTint: [255, 255, 255],
    gray2: hsl(224, 10, 23),
    accent: amber(700),
  },
};

const mutedOpacity = Number(css.match(/\.dxf-flow code\.muted\s*\{[^}]*opacity:\s*([\d.]+)/)?.[1]);

describe("hero flow diagram contrast", () => {
  it("reads the muted opacity from brand.css", () => {
    assert.ok(mutedOpacity > 0 && mutedOpacity <= 1);
  });
  for (const [theme, t] of Object.entries(THEMES)) {
    const panel = mix(t.glassTint, t.bg, t.glass);
    for (const [name, fg, opacity] of [
      ["code", t.gray2, 1],
      ["code b", t.accent, 1],
      ["code.muted", t.gray2, mutedOpacity],
      ["code.muted b", t.accent, mutedOpacity],
    ]) {
      it(`${theme}: ${name} is at least 4.5:1`, () => {
        const r = ratio(mix(fg, panel, opacity), panel);
        assert.ok(r >= 4.5, `${theme} ${name} is ${r.toFixed(2)}:1`);
      });
    }
  }
});
