import { describe, expect, it } from "vitest";
import { VIEWER_STYLE } from "../src/viewer-style.js";
import { copyIdAstro, annotatedShotAstro } from "../src/starlight-components.js";
import { shotLightboxAstro } from "../src/starlight-lightbox.js";
import { UI_TABLES } from "../src/ui-strings.js";

// Guard for the viewer's emitted CSS: mono only on code selectors, no side-stripe borders, no
// layout-property transitions, no blurred drop shadows. Exceptions are listed with a reason.

const MONO = /monospace|ui-monospace|\bmono\b|Menlo|Consolas|Courier/i;
const CODE_SELECTOR = /(^|[\s,>+~])(code|pre|kbd-code|samp)\b/;
/** Selectors allowed to carry a mono face. Empty: the viewer sets no mono face at all. */
const MONO_EXCEPTIONS: string[] = [];
/** Selectors allowed a one-sided border wider than 1px. Each needs a reason. */
const STRIPE_EXCEPTIONS: Record<string, string> = {
  // Arrowheads are drawn with transparent side borders; they are shapes, not rails.
  ".sd-arrow": "triangle drawn with borders",
};
const LAYOUT_PROPS =
  /\b(width|height|top|left|right|bottom|margin|padding|inset|flex|grid|gap|font-size|border|max-height|min-height)\b/;

interface Rule {
  sel: string;
  body: string;
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

function styleBlocks(src: string): string {
  return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

const en = UI_TABLES.en;
const SOURCES: Record<string, string> = {
  "viewer-style.ts": VIEWER_STYLE,
  "CopyId.astro": styleBlocks(copyIdAstro(en)),
  "AnnotatedShot.astro": styleBlocks(annotatedShotAstro(en)),
  "ShotLightbox.astro": styleBlocks(shotLightboxAstro(en)),
};

describe("viewer emitted CSS guard", () => {
  for (const [name, css] of Object.entries(SOURCES)) {
    const rs = rules(css);
    it(`${name}: parsed rules`, () => expect(rs.length).toBeGreaterThan(0));

    it(`${name}: mono only on code selectors`, () => {
      const bad = rs.filter(
        (r) => MONO.test(r.body) && !CODE_SELECTOR.test(r.sel) && !MONO_EXCEPTIONS.includes(r.sel),
      );
      expect(bad.map((r) => r.sel)).toEqual([]);
    });

    it(`${name}: no side-stripe borders`, () => {
      const bad = rs.filter((r) => {
        if (Object.keys(STRIPE_EXCEPTIONS).some((k) => r.sel.startsWith(k))) return false;
        return [
          ...r.body.matchAll(/border-(?:left|right|inline-start|inline-end)\s*:\s*(\d+)px/g),
        ].some((m) => Number(m[1]) > 1);
      });
      expect(bad.map((r) => r.sel)).toEqual([]);
    });

    it(`${name}: transitions animate transform or opacity only`, () => {
      const bad = rs.filter((r) =>
        [...r.body.matchAll(/transition(?:-property)?\s*:\s*([^;]+)/g)].some(
          (m) =>
            LAYOUT_PROPS.test(m[1].replace(/\b(transform|opacity)\b/g, "")) || /\ball\b/.test(m[1]),
        ),
      );
      expect(bad.map((r) => r.sel)).toEqual([]);
    });

    it(`${name}: no blurred drop shadows`, () => {
      const bad = rs.filter((r) =>
        [...r.body.matchAll(/box-shadow\s*:\s*([^;]+)/g)].some((m) =>
          m[1].split(/,(?![^(]*\))/).some((layer) => {
            if (/^\s*(none|var\()/.test(layer) && !/\d/.test(layer.replace(/var\([^)]*\)/g, "")))
              return false;
            const n = layer.replace(/rgba?\([^)]*\)/g, "").match(/-?\d*\.?\d+(?:px)?/g) ?? [];
            return n.length >= 3 && parseFloat(n[2]) > 0;
          }),
        ),
      );
      expect(bad.map((r) => r.sel)).toEqual([]);
    });
  }

  it("headings balance their wrap", () => {
    expect(VIEWER_STYLE).toMatch(/h1, h2, h3, h4, h5, h6 \{ text-wrap: balance; \}/);
  });

  it("emitted viewer sources carry no em dash", () => {
    for (const [name, css] of Object.entries(SOURCES)) expect(css, name).not.toContain("—");
    for (const s of [copyIdAstro(en), annotatedShotAstro(en), shotLightboxAstro(en)])
      expect(s).not.toContain("—");
  });
});
