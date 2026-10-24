// The overlay runtime against a small fake DOM (the package has no DOM library): overlays are drawn
// only for shots near the viewport, a resize redraws only those, labels are measured in one batch,
// and a badge stays inside the image. Also the DOM-free rules in overlay-geometry.ts and the badge
// CSS those rules assume.

import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  BADGE_HEIGHT,
  BADGE_WIDTH,
  NEAR_MARGIN,
  badgeOrigin,
  needsRedraw,
} from "../src/overlay-geometry.js";
import { VIEWER_STYLE } from "../src/viewer-style.js";

const BUNDLE = new URL("../dist/generated/overlay.js", import.meta.url);

type Listener = (e?: unknown) => void;

class FakeEl {
  className = "";
  textContent = "";
  type = "";
  dataset: Record<string, string> = {};
  style = { cssText: "" };
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  classList = {
    set: new Set<string>(),
    add: (...c: string[]) => c.forEach((x) => this.classList.set.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classList.set.delete(x)),
    contains: (c: string) => this.classList.set.has(c),
    toggle: (c: string, on?: boolean) =>
      (on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c),
  };
  constructor(
    public tagName: string,
    private dom: FakeDom,
  ) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  addEventListener(t: string, fn: Listener) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  appendChild(c: FakeEl) {
    c.parentElement = this;
    this.children.push(c);
    if (this === this.dom.body)
      this.dom.maxProbes = Math.max(this.dom.maxProbes, this.children.length);
    return c;
  }
  removeChild(c: FakeEl) {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  contains() {
    return false;
  }
  closest() {
    return null;
  }
  private all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel.startsWith(".")) return this.all().filter((e) => e.className === sel.slice(1));
    return this.all().filter((e) => e.tagName === sel.toUpperCase());
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  // Probes: 7 px per character plus padding, 20 px per line.
  get offsetWidth() {
    this.dom.layoutReads += 1;
    return this.textContent.length * 7 + 22;
  }
  get offsetHeight() {
    this.dom.layoutReads += 1;
    return 20;
  }
}

class FakeImg extends FakeEl {
  complete = true;
  naturalWidth = 1280;
  naturalHeight = 800;
  clientWidth = 640;
  clientHeight = 400;
}

class FakeDom {
  body: FakeEl;
  shots: FakeEl[] = [];
  maxProbes = 0;
  layoutReads = 0;
  frames: Array<() => void> = [];
  winListeners = new Map<string, Listener>();
  observed: FakeEl[] = [];
  ioCallback: ((entries: Array<{ target: FakeEl; isIntersecting: boolean }>) => void) | null = null;
  ioOptions: unknown = null;
  constructor() {
    this.body = new FakeEl("BODY", this);
  }
  addShot(anns: unknown[]): FakeEl {
    const shot = new FakeEl("DIV", this);
    shot.className = "shot";
    shot.setAttribute("data-anns", JSON.stringify(anns));
    const img = new FakeImg("IMG", this);
    img.setAttribute("src", "s.png");
    shot.appendChild(img);
    this.shots.push(shot);
    return shot;
  }
  img(shot: FakeEl): FakeImg {
    return shot.querySelector("img") as FakeImg;
  }
  flush() {
    const f = this.frames;
    this.frames = [];
    for (const cb of f) cb();
  }
  enter(shots: FakeEl[], isIntersecting = true) {
    this.ioCallback?.(shots.map((target) => ({ target, isIntersecting })));
  }
}

async function runBundle(dom: FakeDom, withIo = true): Promise<void> {
  const document = {
    documentElement: { lang: "en" },
    body: dom.body,
    activeElement: null,
    createElement: (t: string) => new FakeEl(t.toUpperCase(), dom),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel === ".shot") return dom.shots;
      if (sel === ".shot[data-anns]") return dom.shots.filter((s) => s.hasAttribute("data-anns"));
      return [];
    },
    addEventListener: () => {},
  };
  const window = {
    requestAnimationFrame: (cb: () => void) => dom.frames.push(cb),
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: (t: string, fn: Listener) => dom.winListeners.set(t, fn),
  };
  class IO {
    constructor(cb: FakeDom["ioCallback"], opts: unknown) {
      dom.ioCallback = cb;
      dom.ioOptions = opts;
    }
    observe(el: FakeEl) {
      dom.observed.push(el);
    }
  }
  const ctx: Record<string, unknown> = { window, document };
  if (withIo) ctx.IntersectionObserver = IO;
  vm.runInNewContext(await readFile(BUNDLE, "utf8"), ctx);
}

const ANNS = [
  {
    step: "s",
    selector: "#a",
    copy: "Open the menu",
    index: 1,
    bounding_box: { x: 10, y: 10, width: 80, height: 30 },
  },
  {
    step: "s",
    selector: "#b",
    copy: "Pick one",
    index: 2,
    bounding_box: { x: 1270, y: 790, width: 10, height: 10 },
  },
];

const drawn = (shot: FakeEl) => shot.querySelectorAll(".sd-ann").length;

describe("overlay redraw near the viewport", () => {
  it("draws only the shots the observer reports near, out of 500", async () => {
    const dom = new FakeDom();
    for (let i = 0; i < 500; i++) dom.addShot(ANNS);
    await runBundle(dom);
    expect(dom.observed).toHaveLength(500);
    expect(dom.ioOptions).toEqual({ rootMargin: NEAR_MARGIN });
    dom.flush();
    expect(dom.shots.filter((s) => drawn(s) > 0)).toHaveLength(0);
    dom.enter(dom.shots.slice(0, 3));
    dom.flush();
    expect(dom.shots.map(drawn).filter((n) => n > 0)).toEqual([2, 2, 2]);
    expect(dom.shots[0]!.dataset.drawnWidth).toBe("640");
  });

  it("redraws only near shots on resize, and a far one when it comes near", async () => {
    const dom = new FakeDom();
    for (let i = 0; i < 500; i++) dom.addShot(ANNS);
    await runBundle(dom);
    dom.enter(dom.shots.slice(0, 3));
    dom.flush();
    for (const s of dom.shots) dom.img(s).clientWidth = 300;
    dom.layoutReads = 0;
    dom.winListeners.get("resize")!();
    dom.flush();
    expect(dom.shots.slice(0, 3).map((s) => s.dataset.drawnWidth)).toEqual(["300", "300", "300"]);
    expect(dom.shots.slice(3).every((s) => s.dataset.drawnWidth === undefined)).toBe(true);
    // two labels on each of three shots, one width and one height read each, nothing per far shot
    expect(dom.layoutReads).toBe(12);
    dom.enter([dom.shots[0]!], false);
    dom.enter([dom.shots[200]!]);
    dom.flush();
    expect(dom.shots[200]!.dataset.drawnWidth).toBe("300");
  });

  it("measures every label of a frame in one batch of probes, then removes them", async () => {
    const dom = new FakeDom();
    for (let i = 0; i < 4; i++) dom.addShot(ANNS);
    await runBundle(dom);
    dom.enter(dom.shots);
    dom.flush();
    expect(dom.maxProbes).toBe(8);
    expect(dom.body.children).toHaveLength(0);
  });

  it("draws every shot when the browser has no IntersectionObserver", async () => {
    const dom = new FakeDom();
    for (let i = 0; i < 5; i++) dom.addShot(ANNS);
    await runBundle(dom, false);
    dom.flush();
    expect(dom.shots.map(drawn)).toEqual([2, 2, 2, 2, 2]);
  });

  it("draws every loaded shot before printing", async () => {
    const dom = new FakeDom();
    for (let i = 0; i < 5; i++) dom.addShot(ANNS);
    await runBundle(dom);
    dom.winListeners.get("beforeprint")!();
    expect(dom.shots.map(drawn)).toEqual([2, 2, 2, 2, 2]);
  });

  it("keeps a badge on a bottom-right target wholly inside the image", async () => {
    const dom = new FakeDom();
    const shot = dom.addShot(ANNS);
    await runBundle(dom);
    dom.enter([shot]);
    dom.flush();
    const badge = shot.querySelectorAll(".sd-badge")[1]!;
    expect(badge.style.cssText).toBe(`left:${640 - BADGE_WIDTH}px;top:${400 - BADGE_HEIGHT}px`);
  });
});

describe("badgeOrigin", () => {
  it("is the real rendered badge size: 22 min + 2 x 6 padding + 2 x 2 border wide, 26 tall", () => {
    expect(BADGE_WIDTH).toBe(38);
    expect(BADGE_HEIGHT).toBe(26);
    expect(VIEWER_STYLE).toContain(
      ".sd-badge { position: absolute; min-width: 22px; height: 22px; padding: 0 6px; line-height: 22px;",
    );
    expect(VIEWER_STYLE).toMatch(
      /\.sd-badge \{[^}]*border: 2px solid #fff;[^}]*box-sizing: content-box;/,
    );
  });

  it("pulls the badge 8 px up and left of the target", () => {
    expect(
      badgeOrigin({ x: 100, y: 50, width: 20, height: 20 }, { width: 300, height: 200 }),
    ).toEqual({ x: 92, y: 42 });
  });

  it("clamps the whole badge inside the right and bottom edges", () => {
    const o = badgeOrigin({ x: 295, y: 195, width: 5, height: 5 }, { width: 300, height: 200 });
    expect(o).toEqual({ x: 300 - 38, y: 200 - 26 });
    expect(o.x + BADGE_WIDTH).toBeLessThanOrEqual(300);
  });

  it("sits at 0 on the top-left edge and on an image smaller than the badge", () => {
    expect(badgeOrigin({ x: 2, y: 3, width: 5, height: 5 }, { width: 300, height: 200 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(badgeOrigin({ x: 10, y: 10, width: 5, height: 5 }, { width: 20, height: 20 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("needsRedraw", () => {
  const base = { near: true, loaded: true, width: 300, drawnWidth: undefined };
  it("redraws a near, loaded shot at a new width only", () => {
    expect(needsRedraw(base)).toBe(true);
    expect(needsRedraw({ ...base, drawnWidth: "300" })).toBe(false);
    expect(needsRedraw({ ...base, drawnWidth: "640" })).toBe(true);
  });
  it("skips far, unloaded and zero-width shots", () => {
    expect(needsRedraw({ ...base, near: false })).toBe(false);
    expect(needsRedraw({ ...base, loaded: false })).toBe(false);
    expect(needsRedraw({ ...base, width: 0 })).toBe(false);
  });
});
