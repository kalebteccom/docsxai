// In-page helpers behind `BrowserDriver.hideElements` / `showElements`.
//
// Both functions run inside the page (Playwright serializes them with `locator.evaluateAll`), so
// they stay self-contained: no imports of values, no references to module scope. They are fixed
// engine code. The flow supplies only a selector, which Playwright resolves to elements outside
// the page; nothing from the flow reaches the page as CSS or script.
//
// Hiding is `visibility: hidden !important`, applied through a constructable stylesheet adopted
// onto the element's own root (the document, or the shadow root the element lives in) and keyed
// by a data attribute. Visibility keeps the element's box, so nothing around it reflows, and it
// inherits into a shadow tree, so hiding a host hides its contents too. Constructable stylesheets
// and attribute writes are not blocked by a page's Content-Security-Policy; a `<style>` element
// would be. The DOM lib isn't in this package's TypeScript config, so the shapes used are local.

/** Attribute that marks an element hidden by a `hide` step. The stylesheet rule keys on it. */
export const HIDDEN_ATTR = "data-docsxai-hidden";

interface DomSheet {
  cssRules: ArrayLike<{ cssText: string }>;
  replaceSync(css: string): void;
}
interface DomRoot {
  adoptedStyleSheets?: DomSheet[];
}
interface DomMarkable {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getRootNode(): DomRoot | null;
}

/** Mark `els` hidden and make sure each one's root carries the rule that hides marked elements. */
export function markHidden(els: unknown[], attr: string): void {
  const sheetCtor = (globalThis as { CSSStyleSheet?: new () => DomSheet }).CSSStyleSheet;
  for (const el of els as DomMarkable[]) {
    el.setAttribute(attr, "");
    const root = el.getRootNode();
    if (!root || !root.adoptedStyleSheets || !sheetCtor) continue;
    const present = root.adoptedStyleSheets.some((s) =>
      s.cssRules[0]?.cssText.startsWith(`[${attr}]`),
    );
    if (present) continue;
    const sheet = new sheetCtor();
    sheet.replaceSync(`[${attr}] { visibility: hidden !important; }`);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}

/** Remove the hidden mark from `els`; the stylesheet stays, and matches nothing. */
export function unmarkHidden(els: unknown[], attr: string): void {
  for (const el of els as DomMarkable[]) el.removeAttribute(attr);
}
