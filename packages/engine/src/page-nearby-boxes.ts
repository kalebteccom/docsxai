// In-page scan behind `BrowserDriver.nearbyBoxes`.
//
// `collectNearbyBoxes` runs inside the page (Playwright serializes it with `locator.evaluate`), so
// it must stay self-contained: no imports of values, no references to module scope. It imports no
// Playwright either; the driver is the only module that does. The DOM lib isn't in this package's
// TypeScript config, so the few DOM shapes it touches are declared locally.

import { type NearbyBoxes } from "./obstacles.js";

interface DomRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface DomStyle {
  display: string;
  visibility: string;
  opacity: string;
  overflow: string;
  overflowX: string;
  overflowY: string;
}
interface DomElement {
  getBoundingClientRect(): DomRect;
  parentElement: DomElement | null;
  contains(other: unknown): boolean;
  tagName: string;
  ownerDocument: DomDocument;
}
interface DomTextNode {
  nodeValue: string | null;
  parentElement: DomElement | null;
}
interface DomDocument {
  body: DomElement | null;
  defaultView: {
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
    getComputedStyle(el: unknown): DomStyle;
  };
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  createTreeWalker(root: unknown, whatToShow: number): { nextNode(): unknown };
  createRange(): { selectNodeContents(node: unknown): void; getClientRects(): ArrayLike<DomRect> };
}

/**
 * Boxes of the visible text and interactive elements within `radius` CSS px of `targetArg`, in
 * screenshot pixels. Text is measured per rendered line (the text itself, not its block), so a
 * paragraph beside the target contributes the lines that are there. Left out: anything inside the
 * target, interactive elements that contain it, hidden or fully clipped content, scripts and styles.
 * The result is in document order; `selectObstacles` sorts, clips and caps it.
 */
export function collectNearbyBoxes(targetArg: unknown, radius: number): NearbyBoxes {
  const target = targetArg as DomElement;
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  const dpr = view.devicePixelRatio || 1;
  const t = target.getBoundingClientRect();
  const near = {
    left: t.left - radius,
    top: t.top - radius,
    right: t.right + radius,
    bottom: t.bottom + radius,
  };
  const boxes: NearbyBoxes["boxes"] = [];

  // Add `r` (viewport CSS px) when `owner` renders it: visible, not clipped away by an ancestor's
  // overflow, and inside the viewport. `clipSelf` lets the owner's own overflow clip text it holds.
  const add = (r: DomRect, owner: DomElement, clipSelf: boolean): void => {
    let { left, top, right, bottom } = r;
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, view.innerWidth);
    bottom = Math.min(bottom, view.innerHeight);
    for (let cur: DomElement | null = owner; cur; cur = cur.parentElement) {
      const cs = view.getComputedStyle(cur);
      if (cs.display === "none" || cs.opacity === "0") return;
      if (cur === owner && cs.visibility !== "visible") return;
      const clips =
        cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible";
      if (clips && (cur !== owner || clipSelf)) {
        const cr = cur.getBoundingClientRect();
        left = Math.max(left, cr.left);
        top = Math.max(top, cr.top);
        right = Math.min(right, cr.right);
        bottom = Math.min(bottom, cr.bottom);
      }
    }
    if (right <= left || bottom <= top) return;
    if (right < near.left || left > near.right || bottom < near.top || top > near.bottom) return;
    boxes.push({
      x: left * dpr,
      y: top * dpr,
      width: (right - left) * dpr,
      height: (bottom - top) * dpr,
    });
  };

  const controls = doc.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
      '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], ' +
      '[role="tab"], [role="menuitem"], [role="combobox"], [role="option"], ' +
      '[contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex^="-"])',
  );
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i]!;
    if (el === target || target.contains(el) || el.contains(target)) continue;
    add(el.getBoundingClientRect(), el, false);
  }

  if (doc.body) {
    const range = doc.createRange();
    const walker = doc.createTreeWalker(doc.body, 4); // NodeFilter.SHOW_TEXT
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as DomTextNode;
      const owner = text.parentElement;
      if (!owner || !/\S/.test(text.nodeValue ?? "") || target.contains(n)) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(owner.tagName)) continue;
      range.selectNodeContents(n);
      const lines = range.getClientRects();
      for (let i = 0; i < lines.length; i++) add(lines[i]!, owner, true);
    }
  }

  return {
    image: { width: Math.round(view.innerWidth * dpr), height: Math.round(view.innerHeight * dpr) },
    scale: dpr,
    boxes,
  };
}
