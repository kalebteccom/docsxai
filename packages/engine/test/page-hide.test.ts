import { afterEach, describe, expect, it } from "vitest";
import { inferHaltCause } from "../src/flow-runtime.js";
import { HIDDEN_ATTR, markHidden, unmarkHidden } from "../src/page-hide.js";

// markHidden runs in the page, but it only touches a few DOM members, so it can be driven here
// with stand-ins. The real-browser behaviour is covered by keystone-hide.test.ts.

interface FakeSheet {
  cssRules: Array<{ cssText: string }>;
  replaceSync(css: string): void;
}
class FakeCSSStyleSheet implements FakeSheet {
  cssRules: Array<{ cssText: string }> = [];
  replaceSync(css: string) {
    this.cssRules = [{ cssText: css }];
  }
}

const fakeEl = (root: unknown) => {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    removeAttribute: (n: string) => attrs.delete(n),
    getRootNode: () => root,
  };
};

const g = globalThis as { CSSStyleSheet?: unknown };
const original = g.CSSStyleSheet;
afterEach(() => {
  g.CSSStyleSheet = original;
});

describe("markHidden", () => {
  it("marks the element and adopts one rule per root, not one per element", () => {
    g.CSSStyleSheet = FakeCSSStyleSheet;
    const root = { adoptedStyleSheets: [] as FakeSheet[] };
    const a = fakeEl(root);
    const b = fakeEl(root);
    markHidden([a, b], HIDDEN_ATTR);
    expect(a.attrs.has(HIDDEN_ATTR)).toBe(true);
    expect(b.attrs.has(HIDDEN_ATTR)).toBe(true);
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.adoptedStyleSheets[0]!.cssRules[0]!.cssText).toBe(
      `[${HIDDEN_ATTR}] { visibility: hidden !important; } [${HIDDEN_ATTR}], [${HIDDEN_ATTR}] * { transition: none !important; }`,
    );
    unmarkHidden([a], HIDDEN_ATTR);
    expect(a.attrs.has(HIDDEN_ATTR)).toBe(false);
  });

  it("throws a diagnostic, and marks nothing, when a root has no adoptedStyleSheets", () => {
    g.CSSStyleSheet = FakeCSSStyleSheet;
    const ok = fakeEl({ adoptedStyleSheets: [] });
    const bad = fakeEl({});
    expect(() => markHidden([ok, bad], HIDDEN_ATTR)).toThrow(/docsxai: cannot hide/);
    expect(ok.attrs.size).toBe(0);
    expect(bad.attrs.size).toBe(0);
  });

  it("throws when the browser has no CSSStyleSheet constructor", () => {
    delete g.CSSStyleSheet;
    const el = fakeEl({ adoptedStyleSheets: [] });
    expect(() => markHidden([el], HIDDEN_ATTR)).toThrow(/constructable stylesheets/);
    expect(el.attrs.size).toBe(0);
  });

  it("throws for an element with no root", () => {
    g.CSSStyleSheet = FakeCSSStyleSheet;
    expect(() => markHidden([fakeEl(null)], HIDDEN_ATTR)).toThrow(/cannot hide/);
  });

  it("the halt message gets a cause prefix", () => {
    expect(inferHaltCause("docsxai: cannot hide: this browser has no constructable")).toMatch(
      /hide rule/,
    );
  });
});
