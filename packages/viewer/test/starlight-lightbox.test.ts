// The tap-to-enlarge lightbox of the Starlight site emit: the trigger markup in AnnotatedShot, the
// shared ShotLightbox component's CSS, and its script run against a small fake DOM (the package has
// no DOM library): open on click, Enter and Space, focus on Close, focus trap, Escape, tap outside
// and drag down to close, focus back on the trigger, and a modified click left to the browser.

import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { annotatedShotAstro } from "../src/starlight-components.js";
import { DISMISS_DRAG_PX, shotLightboxAstro } from "../src/starlight-lightbox.js";
import { UI_TABLES } from "../src/ui-strings.js";

const EN = UI_TABLES.en;
const ES = UI_TABLES.es;

type Handler = (e: FakeEvent) => void;
interface FakeEvent {
  type: string;
  target?: FakeNode;
  key?: string;
  shiftKey?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  touches?: Array<{ clientX: number; clientY: number }>;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
}

class FakeNode {
  className = "";
  textContent = "";
  type = "";
  alt = "";
  src = "";
  decoding = "";
  tabIndex = -1;
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;
  currentSrc = "";
  open = false;
  scrollTop = 0;
  scrollLeft = 0;
  isConnected = true;
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  style: Record<string, string> = {};
  attrs = new Map<string, string>();
  handlers = new Map<string, Handler[]>();
  classes = new Set<string>();
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  };
  constructor(
    public tagName: string,
    private dom: LightboxDom,
  ) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  appendChild(c: FakeNode) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeNode[]) {
    for (const c of cs) this.appendChild(c);
  }
  addEventListener(t: string, fn: Handler) {
    this.handlers.set(t, [...(this.handlers.get(t) ?? []), fn]);
  }
  focus() {
    this.dom.active = this;
  }
  querySelector(sel: string): FakeNode | null {
    for (const c of this.children) {
      if (c.tagName === sel.toUpperCase()) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  closest(sel: string): FakeNode | null {
    if (sel !== "a[data-docsx-zoom]") return null;
    if (this.attrs.has("data-docsx-zoom")) return this;
    return this.parent ? this.parent.closest(sel) : null;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}

class LightboxDom {
  active: FakeNode | null = null;
  body = new FakeNode("BODY", this);
  docHandlers = new Map<string, Handler[]>();
  links: FakeNode[] = [];
  addLink(href: string): FakeNode {
    const a = new FakeNode("A", this);
    a.setAttribute("href", href);
    a.setAttribute("data-docsx-zoom", "");
    const img = new FakeNode("IMG", this);
    img.alt = "Screenshot of step pay-1";
    img.naturalWidth = 1280;
    img.naturalHeight = 800;
    a.appendChild(img);
    this.body.appendChild(a);
    this.links.push(a);
    return a;
  }
  get dialog(): FakeNode | undefined {
    return this.body.children.find((c) => c.tagName === "DIALOG");
  }
  /** Dispatch on the target's own handlers, then the document's (bubbling, simplified). */
  fire(target: FakeNode, e: FakeEvent): FakeEvent {
    const ev: FakeEvent = { button: 0, ...e, target, defaultPrevented: false };
    ev.preventDefault = () => {
      ev.defaultPrevented = true;
    };
    for (let n: FakeNode | null = target; n; n = n.parent)
      for (const h of n.handlers.get(e.type) ?? []) h(ev);
    for (const h of this.docHandlers.get(e.type) ?? []) h(ev);
    return ev;
  }
}

function runScript(dom: LightboxDom, script: string, dialogs = true): void {
  class HTMLDialogElement {
    showModal() {}
  }
  const document = {
    body: dom.body,
    get activeElement() {
      return dom.active;
    },
    createElement: (t: string) => new FakeNode(t.toUpperCase(), dom),
    querySelectorAll: (sel: string) => (sel === "a[data-docsx-zoom]" ? dom.links : []),
    addEventListener: (t: string, fn: Handler) =>
      dom.docHandlers.set(t, [...(dom.docHandlers.get(t) ?? []), fn]),
  };
  const ctx: Record<string, unknown> = { document, window: {} };
  if (dialogs) ctx.HTMLDialogElement = HTMLDialogElement;
  vm.runInNewContext(script, ctx);
}

const scriptOf = (astro: string) => astro.split("<script>")[1]!.split("</script>")[0]!;

function setup(dialogs = true) {
  const dom = new LightboxDom();
  const link = dom.addLink("/_astro/pay-1.png");
  runScript(dom, scriptOf(shotLightboxAstro(EN)), dialogs);
  return { dom, link, img: link.querySelector("img")! };
}

describe("AnnotatedShot trigger", () => {
  it("wraps the screenshot in a link to its own file, alt text kept, box reserved", () => {
    const shot = annotatedShotAstro(EN);
    expect(shot).toMatch(
      /<a\s+class="docsx-zoom"\s+href=\{resolved\}\s+data-docsx-zoom\s+aria-label=\{`Enlarge screenshot of step \$\{alt\}`\}\s*>\s*<img\s+src=\{resolved\}\s+alt=\{`Screenshot of step \$\{alt\}`\}\s+width=\{width\}\s+height=\{height\}/,
    );
    expect(shot).toContain('<span class="docsx-zoom-hint" aria-hidden="true">');
    expect(shot).toContain('import ShotLightbox from "./ShotLightbox.astro";');
    expect(shot).toContain("{!missing && <ShotLightbox />}");
  });

  it("is worded in Spanish for an es site", () => {
    const shot = annotatedShotAstro(ES);
    expect(shot).toContain("aria-label={`Ampliar la captura del paso ${alt}`}");
    expect(shot).toMatch(/<\/svg>\s+Ampliar\s+<\/span>/);
    const box = shotLightboxAstro(ES);
    expect(box).toContain('closeBtn.textContent = "Cerrar";');
    expect(box).toContain('dialog.setAttribute("aria-label", "Captura a tamaño completo");');
  });
});

describe("ShotLightbox CSS", () => {
  const css = shotLightboxAstro(EN).split("<style is:global>")[1]!.split("</style>")[0]!;

  it("uses theme variables only, no raw colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|hsl\(/);
    expect(css).toContain("background: var(--sl-color-bg);");
  });

  it("gives the trigger and Close a 44 px target and keeps Close inside the safe area", () => {
    expect(css).toMatch(/\.docsx-zoom \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.docsx-lightbox-close \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(css).toContain("top: calc(env(safe-area-inset-top, 0px) + 0.5rem);");
    expect(css).toContain("right: calc(env(safe-area-inset-right, 0px) + 0.5rem);");
  });

  it("lets the frame pan and pinch-zoom, and moves only without reduced motion", () => {
    expect(css).toContain("touch-action: pan-x pan-y pinch-zoom;");
    expect(css).toContain("overscroll-behavior: contain;");
    const [before, motion] = css.split("@media (prefers-reduced-motion: no-preference)");
    expect(before).not.toMatch(/animation|transition/);
    expect(motion).toMatch(/animation: docsx-lightbox-in/);
  });

  it("shows the enlarge hint always on touch and narrow screens, on hover or focus otherwise", () => {
    expect(css).toMatch(/\.docsx-zoom-hint \{[^}]*position: absolute;[^}]*display: none;/);
    expect(css).toMatch(
      /@media \(hover: none\), \(max-width: 50rem\) \{\s*\.docsx-zoom-hint \{\s*display: inline-flex;/,
    );
  });
});

describe("ShotLightbox script", () => {
  it("gives each trigger button semantics", () => {
    const { link } = setup();
    expect(link.getAttribute("role")).toBe("button");
  });

  it("opens on a tap with the full-size file, alt text and size, and focuses Close", () => {
    const { dom, img } = setup();
    const ev = dom.fire(img, { type: "click" });
    expect(ev.defaultPrevented).toBe(true);
    const d = dom.dialog!;
    expect(d.open).toBe(true);
    expect(d.getAttribute("aria-label")).toBe("Full-size screenshot");
    const big = d.querySelector("img")!;
    expect(big.src).toBe("/_astro/pay-1.png");
    expect(big.alt).toBe("Screenshot of step pay-1");
    expect([big.width, big.height]).toEqual([1280, 800]);
    expect(dom.active?.className).toBe("docsx-lightbox-close");
    expect(dom.active?.textContent).toBe("Close");
  });

  it("opens on Space and leaves other keys alone", () => {
    const { dom, link } = setup();
    expect(dom.fire(link, { type: "keydown", key: "a" }).defaultPrevented).toBe(false);
    expect(dom.dialog).toBeUndefined();
    expect(dom.fire(link, { type: "keydown", key: " " }).defaultPrevented).toBe(true);
    expect(dom.dialog!.open).toBe(true);
  });

  it("leaves a modified or middle click to the browser (new tab)", () => {
    const { dom, img } = setup();
    expect(dom.fire(img, { type: "click", metaKey: true }).defaultPrevented).toBe(false);
    expect(dom.fire(img, { type: "click", button: 1 }).defaultPrevented).toBe(false);
    expect(dom.dialog).toBeUndefined();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { dom, link, img } = setup();
    dom.fire(img, { type: "click" });
    const d = dom.dialog!;
    const esc = dom.fire(d, { type: "cancel" });
    expect(esc.defaultPrevented).toBe(true);
    expect(d.open).toBe(false);
    expect(dom.active).toBe(link);
  });

  it("closes from Close and from a tap on the space around the image, not on the image", () => {
    const { dom, img } = setup();
    dom.fire(img, { type: "click" });
    const d = dom.dialog!;
    const frame = d.children.find((c) => c.className === "docsx-lightbox-frame")!;
    dom.fire(frame.querySelector("img")!, { type: "click" });
    expect(d.open).toBe(true);
    dom.fire(frame, { type: "click" });
    expect(d.open).toBe(false);
    dom.fire(img, { type: "click" });
    dom.fire(d.children[0]!, { type: "click" });
    expect(d.open).toBe(false);
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    const { dom, img } = setup();
    dom.fire(img, { type: "click" });
    const d = dom.dialog!;
    const [close, frame] = d.children;
    expect(dom.fire(close!, { type: "keydown", key: "Tab" }).defaultPrevented).toBe(true);
    expect(dom.active).toBe(frame);
    dom.fire(frame!, { type: "keydown", key: "Tab" });
    expect(dom.active).toBe(close);
    dom.fire(close!, { type: "keydown", key: "Tab", shiftKey: true });
    expect(dom.active).toBe(frame);
  });

  it("closes on a one-finger drag down past the threshold and snaps back short of it", () => {
    const { dom, img } = setup();
    dom.fire(img, { type: "click" });
    const d = dom.dialog!;
    const frame = d.children[1]!;
    const t = (y: number, x = 100) => [{ clientX: x, clientY: y }];
    dom.fire(frame, { type: "touchstart", touches: t(100) });
    dom.fire(frame, { type: "touchmove", touches: t(140) });
    expect(frame.style.transform).toBe("translateY(40px)");
    dom.fire(frame, { type: "touchend", touches: [] });
    expect(d.open).toBe(true);
    expect(frame.style.transform).toBe("");
    expect(frame.classes.has("is-settling")).toBe(true);
    dom.fire(frame, { type: "touchstart", touches: t(100) });
    dom.fire(frame, { type: "touchmove", touches: t(100 + DISMISS_DRAG_PX) });
    dom.fire(frame, { type: "touchend", touches: [] });
    expect(d.open).toBe(false);
  });

  it("ignores a drag when the frame is scrolled, a sideways pan and a two-finger pinch", () => {
    const { dom, img } = setup();
    dom.fire(img, { type: "click" });
    const d = dom.dialog!;
    const frame = d.children[1]!;
    const t = (y: number, x = 100) => [{ clientX: x, clientY: y }];
    frame.scrollTop = 50;
    dom.fire(frame, { type: "touchstart", touches: t(100) });
    dom.fire(frame, { type: "touchmove", touches: t(400) });
    dom.fire(frame, { type: "touchend", touches: [] });
    expect(d.open).toBe(true);
    frame.scrollTop = 0;
    dom.fire(frame, { type: "touchstart", touches: t(100, 100) });
    dom.fire(frame, { type: "touchmove", touches: t(150, 300) });
    dom.fire(frame, { type: "touchmove", touches: t(400, 300) });
    dom.fire(frame, { type: "touchend", touches: [] });
    expect(d.open).toBe(true);
    dom.fire(frame, { type: "touchstart", touches: [...t(100), ...t(100, 200)] });
    dom.fire(frame, { type: "touchmove", touches: t(400) });
    dom.fire(frame, { type: "touchend", touches: [] });
    expect(d.open).toBe(true);
  });

  it("does nothing without <dialog> support, so the link opens the file", () => {
    const { dom, link, img } = setup(false);
    expect(link.getAttribute("role")).toBeNull();
    expect(dom.fire(img, { type: "click" }).defaultPrevented).toBe(false);
  });
});
