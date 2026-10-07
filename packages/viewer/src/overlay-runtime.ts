// Browser-side overlay runtime for the interactive viewer.
//
// Imports the real `placeCallout` from placement.ts — the same function the static burner
// (burn.ts) uses — so callout placement has exactly one implementation. The package build
// (scripts/bundle-overlay.mjs) bundles this file with esbuild into dist/generated/overlay.js
// (IIFE, es2019, unminified for auditability); render.ts inlines that bundle into every
// emitted flow page.

import { placeCallout, type Side } from "./placement.js";
import type { AnnotationRecord } from "./annotations.js";
import {
  isEditableTarget,
  keyAction,
  stepAnnouncement,
  stepInView,
  targetIndex,
  type StepMove,
  type ViewerAction,
} from "./viewer-keys.js";

const SIDES: readonly string[] = ["top", "bottom", "left", "right"];

interface CalloutSize {
  width: number;
  height: number;
}

// Two-pass sizing on a body-attached probe. The callout cannot be measured in place: when it is
// measured its wrapper is still detached from the document, and the .sd-callout class is
// display:none until :hover — either alone makes offsetWidth/Height resolve to 0, which would bake
// width:0px and collapse the callout into a one-character-per-line column. The probe carries the
// same .sd-callout class (so padding/font/border match), lives in the live render tree for two
// synchronous reads, and is removed immediately. Pass 1: natural single-line width
// (white-space:nowrap, wrap props neutralised) clamped to 280, or to the image width when the image
// is narrower (a phone), so the callout stays inside it. Pass 2: height at that locked width.
function measureCallout(text: string, maxWidth: number): CalloutSize {
  const probe = document.createElement("div");
  probe.className = "sd-callout";
  probe.textContent = text;
  probe.style.cssText =
    "position:fixed;left:-99999px;top:0;display:block;visibility:hidden;" +
    "white-space:nowrap;overflow-wrap:normal;word-break:normal;width:auto;max-width:none";
  document.body.appendChild(probe);
  const cw = Math.min(probe.offsetWidth, maxWidth);
  probe.style.cssText =
    "position:fixed;left:-99999px;top:0;display:block;visibility:hidden;" +
    "white-space:normal;width:" +
    cw +
    "px";
  const height = probe.offsetHeight;
  document.body.removeChild(probe);
  return { width: cw, height };
}

function preferredSide(arrowStyle: string | undefined): Side {
  const pref = (arrowStyle ?? "top").split("-")[0] ?? "top";
  return SIDES.indexOf(pref) >= 0 ? (pref as Side) : "top";
}

// A call-out with copy gets a real button as its halo, so keyboard users reach it with Tab and
// screen readers read the copy from its label. Focus or hover shows the callout (CSS); a click or
// tap pins it open, because iOS Safari does not focus a tapped button. Escape hides it while focus
// or the pointer stays (dismissOpen). A halo without copy is decorative.
function makeHalo(wrap: HTMLElement, label: string): HTMLElement {
  if (!label) {
    const deco = document.createElement("div");
    deco.className = "sd-halo";
    deco.setAttribute("aria-hidden", "true");
    return deco;
  }
  const halo = document.createElement("button");
  halo.type = "button";
  halo.className = "sd-halo";
  halo.setAttribute("aria-label", label);
  halo.addEventListener("click", () => {
    const open = !wrap.classList.contains("sd-open");
    for (const other of Array.from(document.querySelectorAll(".sd-ann.sd-open")))
      other.classList.remove("sd-open");
    wrap.classList.toggle("sd-open", open);
    wrap.classList.remove("sd-dismissed");
  });
  const reset = () => wrap.classList.remove("sd-dismissed");
  halo.addEventListener("blur", () => {
    reset();
    wrap.classList.remove("sd-open");
  });
  halo.addEventListener("mouseleave", reset);
  return halo;
}

/** Escape: hide every callout that is open, focused or hovered. Focus stays where it is. */
function dismissOpen(): boolean {
  const open = Array.from(document.querySelectorAll(".sd-ann")).filter(
    (w) =>
      w.classList.contains("sd-open") || w.matches(":hover") || w.contains(document.activeElement),
  );
  for (const w of open) {
    w.classList.remove("sd-open");
    w.classList.add("sd-dismissed");
  }
  return open.length > 0;
}

function renderOne(
  shot: Element,
  ann: AnnotationRecord,
  sx: number,
  sy: number,
  im: { width: number; height: number },
): void {
  if (!ann.bounding_box) return;
  const bb = ann.bounding_box;
  const t = { x: bb.x * sx, y: bb.y * sy, width: bb.width * sx, height: bb.height * sy };
  const wrap = document.createElement("div");
  wrap.className = "sd-ann";
  const label = (typeof ann.index === "number" ? ann.index + ". " : "") + ann.copy;

  const halo = makeHalo(wrap, ann.copy ? label : "");
  halo.style.cssText =
    "left:" + t.x + "px;top:" + t.y + "px;width:" + t.width + "px;height:" + t.height + "px";
  wrap.appendChild(halo);

  // Numbered badge — only when this image has > 1 call-out (ann.index set by the engine then).
  if (typeof ann.index === "number") {
    const badge = document.createElement("div");
    badge.className = "sd-badge";
    badge.textContent = String(ann.index);
    // top-left of the halo, pulled slightly outside it; clamped to the image
    const bx = Math.max(0, Math.min(t.x - 8, im.width - 22));
    const by = Math.max(0, Math.min(t.y - 8, im.height - 22));
    badge.style.cssText = "left:" + bx + "px;top:" + by + "px";
    // The halo button carries the number in its label; the badge is a larger pointer target for it.
    badge.setAttribute("aria-hidden", "true");
    badge.addEventListener("click", () => halo.click());
    wrap.appendChild(badge);
  }

  if (ann.copy) {
    const co = document.createElement("div");
    co.className = "sd-callout";
    co.setAttribute("aria-hidden", "true");
    co.textContent = label;
    wrap.appendChild(co);
    const c = measureCallout(label, Math.min(280, im.width));
    const p = placeCallout({
      image: im,
      target: t,
      callout: c,
      preferred: preferredSide(ann.arrow_style),
    });
    // Optional nudge — moves callout + arrow together; halo (which highlights the target) stays
    // put. Lets the author shift a callout aside when two annotations would otherwise overlap.
    const nx = ann.nudge && typeof ann.nudge.x === "number" ? ann.nudge.x : 0;
    const ny = ann.nudge && typeof ann.nudge.y === "number" ? ann.nudge.y : 0;
    co.style.cssText =
      "left:" +
      (p.callout.x + nx) +
      "px;top:" +
      (p.callout.y + ny) +
      "px;" +
      "box-sizing:border-box;white-space:normal;width:" +
      c.width +
      "px";

    const ar = document.createElement("div");
    ar.className = "sd-arrow " + p.side;
    ar.setAttribute("aria-hidden", "true");
    let left: number, top: number;
    if (p.side === "top") {
      left = p.arrow.x - 7;
      top = p.arrow.y - 8;
    } else if (p.side === "bottom") {
      left = p.arrow.x - 7;
      top = p.arrow.y;
    } else if (p.side === "left") {
      left = p.arrow.x - 8;
      top = p.arrow.y - 7;
    } else {
      left = p.arrow.x;
      top = p.arrow.y - 7;
    }
    ar.style.cssText = "left:" + (left + nx) + "px;top:" + (top + ny) + "px";
    wrap.appendChild(ar);
  }

  shot.appendChild(wrap);
}

function renderShot(shot: Element): void {
  const img = shot.querySelector("img");
  if (!img || !img.naturalWidth) return;
  for (const old of Array.from(shot.querySelectorAll(".sd-ann"))) shot.removeChild(old);
  let anns: AnnotationRecord[];
  try {
    anns = JSON.parse(shot.getAttribute("data-anns") ?? "[]") as AnnotationRecord[];
  } catch {
    return;
  }
  if (!anns || anns.length === 0) return;
  const sx = img.clientWidth / img.naturalWidth;
  const sy = img.clientHeight / img.naturalHeight;
  const im = { width: img.clientWidth, height: img.clientHeight };
  (shot as HTMLElement).dataset.drawnWidth = String(im.width);
  for (const ann of anns) renderOne(shot, ann, sx, sy, im);
}

// Load, failure and retry for one screenshot. The overlay is drawn once the image has its size;
// a failed load shows the step's error line (alt text stays visible in the image box) with a
// Retry button that requests the file again under a fresh query string, so no cached failure
// is reused.
function watchShot(shot: HTMLElement): void {
  const img = shot.querySelector("img");
  if (!img) return;
  const error = shot.parentElement
    ? shot.parentElement.querySelector<HTMLElement>(".shot-error")
    : null;
  const src = img.getAttribute("src") ?? "";
  let tries = 0;
  const failed = () => {
    shot.classList.add("is-broken");
    if (error) error.hidden = false;
  };
  img.addEventListener("load", () => {
    shot.classList.remove("is-broken");
    if (error) error.hidden = true;
    renderShot(shot);
  });
  img.addEventListener("error", failed);
  const retry = error ? error.querySelector("button") : null;
  if (retry)
    retry.addEventListener("click", () => {
      tries += 1;
      img.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "retry=" + tries;
    });
  if (img.complete) {
    if (img.naturalWidth) renderShot(shot);
    else if (src) failed();
  }
}

function go(): void {
  for (const shot of Array.from(document.querySelectorAll<HTMLElement>(".shot"))) watchShot(shot);
}

// Keyboard navigation. The items are the step sections on a flow page and the flow cards on the
// index. Focus moves to the item (sections carry tabindex="-1"), so Tab continues from there and
// nothing traps focus.
function navItems(): HTMLElement[] {
  const steps = Array.from(document.querySelectorAll<HTMLElement>("section.step"));
  return steps.length ? steps : Array.from(document.querySelectorAll<HTMLElement>("a.flow-card"));
}

function currentItem(items: HTMLElement[]): number {
  const active = document.activeElement;
  const i = active ? items.findIndex((el) => el.contains(active)) : -1;
  return i >= 0 ? i : stepInView(items.map((el) => el.getBoundingClientRect().bottom));
}

function moveTo(move: StepMove): boolean {
  const items = navItems();
  const to = targetIndex(currentItem(items), items.length, move);
  const el = items[to];
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "start" });
  const live = document.getElementById("sd-live");
  const heading = el.querySelector("h2");
  if (live && heading)
    live.textContent = stepAnnouncement(to, items.length, heading.textContent ?? "");
  return true;
}

function followFlowLink(rel: "prev" | "next"): boolean {
  const a = document.querySelector<HTMLAnchorElement>('a[rel="' + rel + '"]');
  if (!a) return false;
  window.location.href = a.href;
  return true;
}

function perform(action: ViewerAction): boolean {
  if (action.kind === "step") return moveTo(action.move);
  if (action.kind === "flow") return followFlowLink(action.move);
  return dismissOpen();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  const action = keyAction({
    key: e.key,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    editable: t ? isEditableTarget(t.tagName, t.getAttribute("type"), t.isContentEditable) : false,
  });
  if (action && perform(action)) e.preventDefault();
}

// A tap outside every call-out closes a pinned one (touch devices never blur the halo).
function onDocumentClick(e: MouseEvent): void {
  const t = e.target instanceof Element ? e.target : null;
  if (t && t.closest(".sd-ann")) return;
  for (const w of Array.from(document.querySelectorAll(".sd-ann.sd-open")))
    w.classList.remove("sd-open");
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("click", onDocumentClick);
// Halo and callout positions are pixels of the displayed image, so a width change (rotating a
// phone, resizing the window) redraws the overlays of the images whose width changed, once per frame.
let resizeQueued = false;
function onResize(): void {
  if (resizeQueued) return;
  resizeQueued = true;
  window.requestAnimationFrame(() => {
    resizeQueued = false;
    for (const shot of Array.from(document.querySelectorAll<HTMLElement>(".shot[data-anns]"))) {
      const img = shot.querySelector("img");
      if (img && img.naturalWidth && String(img.clientWidth) !== shot.dataset.drawnWidth)
        renderShot(shot);
    }
  });
}

// A closed <details> prints as its summary only, so the write-ups open for printing and the
// ones that were closed close again afterwards.
let openedForPrint: HTMLDetailsElement[] = [];
function onBeforePrint(): void {
  openedForPrint = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details.write-up"),
  ).filter((d) => !d.open);
  for (const d of openedForPrint) d.open = true;
}
function onAfterPrint(): void {
  for (const d of openedForPrint) d.open = false;
  openedForPrint = [];
}

window.addEventListener("resize", onResize);
window.addEventListener("beforeprint", onBeforePrint);
window.addEventListener("afterprint", onAfterPrint);
// The script sits at the end of <body>, so every .shot is parsed; images still loading are
// handled by their own load event.
go();
