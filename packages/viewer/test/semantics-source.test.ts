import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string): string => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const style = read("viewer-style.ts");
const markup = read("viewer-markup.ts");

describe("viewer semantics source guards", () => {
  it("balances every heading level", () => {
    expect(style).toMatch(/h1, h2, h3, h4, h5, h6 \{[^}]*text-wrap: balance/);
  });

  it("gives every CSS content glyph an empty alt text", () => {
    // A plain fallback declaration is fine when the same rule repeats it with the alt form.
    const bad = style
      .split("\n")
      .filter((l) => /content:\s*"[^"]+"/.test(l) && !/content:\s*"[^"]+"\s*\/\s*""/.test(l));
    expect(bad).toEqual([]);
  });

  it("caps prose lines at 70ch", () => {
    expect(style).toMatch(/\.md, \.caption, \.notice, \.shortcuts p \{ max-width: 70ch/);
  });

  it("keeps the flow-nav arrow hidden with a no-break space", () => {
    expect(markup).toContain('<span aria-hidden="true">←&nbsp;</span>');
  });

  it("only labels regions by headings", () => {
    for (const m of markup.matchAll(/aria-labelledby="[^"]*"/g)) {
      const id = /"([^"]*)"/.exec(m[0])?.[1] ?? "";
      expect(markup, id).toMatch(new RegExp(`<h[1-6][^>]*id="${id.replace(/[$.{}]/g, "\\$&")}"`));
    }
  });

  it("has :active and :disabled on the copy button", () => {
    expect(style).toContain(".sd-copy:active");
    expect(style).toMatch(/\.sd-copy:disabled/);
  });
});
