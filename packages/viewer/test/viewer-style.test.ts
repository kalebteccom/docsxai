import { describe, expect, it } from "vitest";
import {
  BADGE_FILL,
  DARK_TOKENS,
  LIGHT_TOKENS,
  VIEWER_STYLE,
  tokenCss,
  type ViewerTokens,
} from "../src/viewer-style.js";

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Every text-on-background pair the stylesheet uses, by token name.
const TEXT_PAIRS: Array<[keyof ViewerTokens, keyof ViewerTokens]> = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["fg", "surface2"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface2"],
  ["link", "bg"],
  ["link", "surface"],
  ["danger", "bg"],
  ["danger", "surface"],
];

describe("contrast helper", () => {
  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe.each([
  ["light", LIGHT_TOKENS],
  ["dark", DARK_TOKENS],
])("%s tokens", (_name, tokens) => {
  it.each(TEXT_PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("focus ring meets the 3:1 non-text minimum against the page", () => {
    expect(contrast(tokens.focus, tokens.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("overlay colours (fixed in both schemes)", () => {
  it("badge number (white, 12 px bold) on the badge fill meets AA", () => {
    expect(contrast("#ffffff", BADGE_FILL)).toBeGreaterThanOrEqual(4.5);
  });

  it("callout text meets AA", () => {
    expect(contrast("#ffffff", "#1c1c1c")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("stylesheet", () => {
  it("declares both token sets, the dark one behind prefers-color-scheme", () => {
    expect(VIEWER_STYLE).toContain(`:root { ${tokenCss(LIGHT_TOKENS)} color-scheme: light dark;`);
    expect(VIEWER_STYLE).toContain(
      `@media (prefers-color-scheme: dark) { :root { ${tokenCss(DARK_TOKENS)} } }`,
    );
  });

  it("emits tokens in a fixed order", () => {
    expect(tokenCss(LIGHT_TOKENS).split(" ")[0]).toBe("--fg:");
    expect(tokenCss(DARK_TOKENS)).toMatch(/^--fg: #e8e8e8; --bg: #121212;/);
  });

  it("uses no raw page-text greys that the tokens replaced", () => {
    for (const grey of ["#888", "#777", "#999", "#555"]) {
      expect(VIEWER_STYLE).not.toContain(`color: ${grey}`);
    }
    expect(VIEWER_STYLE).not.toContain("opacity:.6");
  });

  it("shows a visible focus ring on keyboard focus", () => {
    expect(VIEWER_STYLE).toContain(":focus-visible { outline: 3px solid var(--focus);");
  });
});

describe("call-outs without a mouse", () => {
  it("shows the callout on keyboard focus and when pinned by a tap, and hides it after Escape", () => {
    expect(VIEWER_STYLE).toContain(".sd-ann:focus-within .sd-callout");
    expect(VIEWER_STYLE).toContain(".sd-ann.sd-open .sd-callout");
    const reveal = VIEWER_STYLE.indexOf(".sd-ann.sd-open .sd-arrow { display: block; }");
    const dismissed = VIEWER_STYLE.indexOf(
      ".sd-ann.sd-dismissed .sd-callout, .sd-ann.sd-dismissed .sd-arrow { display: none; }",
    );
    // same specificity, so the dismissed rule must come later to win
    expect(reveal).toBeGreaterThan(0);
    expect(dismissed).toBeGreaterThan(reveal);
  });

  it("draws a two-tone focus ring on the halo, readable on light and dark screenshots", () => {
    expect(VIEWER_STYLE).toContain(
      ".sd-halo:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 5px #0b57d0;",
    );
    expect(contrast("#0b57d0", "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("gives halo and badge a touch target of at least 44 px", () => {
    expect(VIEWER_STYLE).toContain("width: max(100%, 44px); height: max(100%, 44px)");
    // badge: 22 px content + 2 x 6 px padding wide, 22 px tall; the hit area adds 11 px per side
    expect(VIEWER_STYLE).toContain(
      '.sd-badge::before { content: ""; position: absolute; inset: -11px; }',
    );
    expect(22 + 2 * 11).toBeGreaterThanOrEqual(44);
  });
});

describe("motion", () => {
  it("animates only opacity (no box-shadow, size or position keyframes)", () => {
    const frames = VIEWER_STYLE.match(/@keyframes [\w-]+ \{(.*?\} )+\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const props = [...f.matchAll(/\{ ([a-z-]+):/g)].map((m) => m[1]);
      expect(new Set(props)).toEqual(new Set(["opacity"]));
    }
    expect(VIEWER_STYLE).not.toMatch(/transition:\s*(box-shadow|width|height|top|left|margin)/);
  });

  it("stops the pulse under prefers-reduced-motion", () => {
    expect(VIEWER_STYLE).toContain(
      "@media (prefers-reduced-motion: reduce) { .sd-halo::after { animation: none; opacity: 0; } }",
    );
  });
});

describe("mobile", () => {
  it("tightens the page padding and stacks flow cards on narrow screens", () => {
    expect(VIEWER_STYLE).toMatch(
      /@media \(max-width: 600px\) \{\s*body \{ padding: 1rem; \}[^@]*\.flow-grid \{ grid-template-columns: 1fr; \}/,
    );
  });

  it("gives header links, disclosures and Retry a 44 px touch target", () => {
    expect(VIEWER_STYLE).toContain(
      ".flow-nav a { display: inline-flex; align-items: center; min-height: 44px;",
    );
    expect(VIEWER_STYLE).toContain("summary { padding: 10px 0; min-height: 44px;");
    expect(VIEWER_STYLE).toMatch(/button\.shot-retry \{[^}]*min-height: 44px; min-width: 44px;/);
  });
});

describe("print", () => {
  const print = VIEWER_STYLE.slice(VIEWER_STYLE.indexOf("@media print"));

  it("has a print block that hides page chrome and the screen-positioned overlay", () => {
    expect(print).toContain(
      ".skip-link, .site-header, .sd-ann, .shot-error { display: none !important; }",
    );
  });

  it("prints black on white whatever the screen scheme", () => {
    expect(print).toContain("--fg: #000000; --bg: #ffffff;");
    expect(print).toContain("color-scheme: light;");
    // after the dark block, so it wins in print
    expect(VIEWER_STYLE.indexOf("@media print")).toBeGreaterThan(
      VIEWER_STYLE.indexOf("@media (prefers-color-scheme: dark)"),
    );
  });

  it("keeps a figure on one page and a step heading with its figure", () => {
    expect(print).toContain(".shot-figure { break-inside: avoid; }");
    expect(print).toContain("h2 { break-after: avoid; }");
  });
});
