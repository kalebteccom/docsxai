// Browser-side overlay runtime for the interactive viewer.
//
// Drawing lives in overlay-draw.ts, which imports the real `placeCallout` from placement.ts (the
// same function the static burner, burn.ts, uses), so callout placement has one implementation.
// The package build (scripts/bundle-overlay.mjs) bundles this file with esbuild into
// dist/generated/overlay.js (IIFE, es2019, unminified for auditability); render.ts inlines that
// bundle into every emitted flow page.

import { COPIED_MS, FALLBACK_MS, copyAnnouncement, type CopyState } from "./viewer-copy.js";
import {
  isEditableTarget,
  keyAction,
  stepAnnouncement,
  stepInView,
  targetIndex,
  type StepMove,
  type ViewerAction,
} from "./viewer-keys.js";
import { fmt, uiStrings } from "./ui-strings.js";
import { NEAR_MARGIN, needsRedraw, type ShotState } from "./overlay-geometry.js";
import { renderShots } from "./overlay-draw.js";

// The page's own text in its language: markup and runtime pick the table from the same <html lang>.
const ui = uiStrings(document.documentElement.lang);

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

// Overlays are drawn only for shots in or near the viewport. An IntersectionObserver keeps the
// near set; a shot that comes near, finishes loading or changes width is queued, and the queue is
// drawn once per frame. Without IntersectionObserver, or while printing, every shot counts as near.
const nearShots = new Set<Element>();
let printing = false;
const io =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              nearShots.add(e.target);
              queueShot(e.target as HTMLElement);
            } else nearShots.delete(e.target);
          }
        },
        { rootMargin: NEAR_MARGIN },
      )
    : null;

function shotState(shot: HTMLElement): ShotState {
  const img = shot.querySelector("img");
  return {
    near: printing || !io || nearShots.has(shot),
    loaded: !!img && img.naturalWidth > 0,
    width: img ? img.clientWidth : 0,
    drawnWidth: shot.dataset.drawnWidth,
  };
}

const queued = new Set<HTMLElement>();
let frameQueued = false;

function flushQueue(): void {
  frameQueued = false;
  const shots = Array.from(queued);
  queued.clear();
  renderShots(shots.filter((shot) => needsRedraw(shotState(shot))));
}

function queueShot(shot: HTMLElement): void {
  if (!shot.hasAttribute("data-anns")) return;
  queued.add(shot);
  if (frameQueued) return;
  frameQueued = true;
  window.requestAnimationFrame(flushQueue);
}

// Polite announcements share one live region with the step moves. The text is cleared first so the
// same message twice in a row is read twice.
function announce(text: string): void {
  const live = document.getElementById("sd-live");
  if (!live) return;
  live.textContent = "";
  window.setTimeout(() => {
    live.textContent = text;
  }, 50);
}

// Load, failure and retry for one screenshot. The overlay is drawn once the image has its size;
// a failed load shows the step's error line, an overlay inside the image's reserved box, with a
// Retry button that requests the file again under a fresh query string, so no cached failure
// is reused. While a retry runs the button reads "Retrying..." and ignores clicks (aria-disabled,
// so focus stays on it); a second failure says how many tries failed; a success hides the line,
// announces it and returns focus to the step if the button had it.
function watchShot(shot: HTMLElement): void {
  const img = shot.querySelector("img");
  if (!img) return;
  const error = shot.parentElement
    ? shot.parentElement.querySelector<HTMLElement>(".shot-error")
    : null;
  const msg = error ? error.querySelector<HTMLElement>(".shot-error-msg") : null;
  const baseMsg = msg ? (msg.textContent ?? "") : "";
  const retry = error ? error.querySelector<HTMLElement>("button") : null;
  const src = img.getAttribute("src") ?? "";
  let tries = 0;
  let retrying = false;
  if (!img.complete) shot.classList.add("is-loading");
  const failed = () => {
    shot.classList.remove("is-loading");
    shot.classList.add("is-broken");
    retrying = false;
    if (error) error.hidden = false;
    if (retry) {
      retry.removeAttribute("aria-disabled");
      retry.textContent = ui.shot.retry;
    }
    if (msg && tries > 0)
      msg.textContent =
        ui.shot.stillPrefix +
        tries +
        (tries === 1 ? ui.shot.stillOne : ui.shot.stillMany) +
        baseMsg;
  };
  img.addEventListener("load", () => {
    shot.classList.remove("is-loading", "is-broken");
    const hadFocus = !!error && error.contains(document.activeElement);
    if (error) error.hidden = true;
    if (tries > 0) {
      retrying = false;
      if (msg) msg.textContent = baseMsg;
      if (retry) {
        retry.removeAttribute("aria-disabled");
        retry.textContent = ui.shot.retry;
      }
      announce(fmt(ui.step.shotLoaded, { name: img.getAttribute("alt") ?? ui.step.shotName }));
      const step = shot.closest<HTMLElement>("section.step");
      if (hadFocus && step) step.focus({ preventScroll: true });
    }
    // A reloaded image is drawn again even at the same width.
    delete shot.dataset.drawnWidth;
    queueShot(shot);
  });
  img.addEventListener("error", failed);
  if (retry)
    retry.addEventListener("click", () => {
      if (retrying) return;
      retrying = true;
      tries += 1;
      retry.setAttribute("aria-disabled", "true");
      retry.textContent = ui.shot.retrying;
      shot.classList.add("is-loading");
      img.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "retry=" + tries;
    });
  if (io && shot.hasAttribute("data-anns")) io.observe(shot);
  if (img.complete) {
    if (img.naturalWidth) queueShot(shot);
    else if (src) failed();
  }
}

// An index thumbnail that fails to load becomes the same placeholder a flow without screenshots
// gets, with a pointer to the flow page, where Retry lives (a card is one link, so it holds no button).
function watchThumb(img: HTMLImageElement): void {
  const fail = () => {
    const box = document.createElement("div");
    box.className = "thumb-missing";
    box.textContent = ui.shot.thumbFailed;
    img.replaceWith(box);
  };
  img.addEventListener("error", fail);
  if (img.complete && !img.naturalWidth && img.getAttribute("src")) fail();
}

// Copy buttons. The value is the button's data-copy. Without navigator.clipboard (an insecure
// context, an old browser) or when the browser refuses, the id's text is selected and the button
// reads "Press Ctrl+C" (or the page language's label). All three labels sit in one grid cell, so no
// state changes the width.
const copyTimers = new Map<HTMLElement, number>();

function selectText(el: unknown): void {
  const sel = window.getSelection();
  if (!(el instanceof Node) || !sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

function showCopy(btn: HTMLElement, state: CopyState, ms: number): void {
  const kind = btn.getAttribute("data-kind") ?? "value";
  const value = btn.getAttribute("data-copy") ?? "";
  btn.setAttribute("data-state", state);
  announce(copyAnnouncement(state, kind, value, ui));
  const old = copyTimers.get(btn);
  if (old !== undefined) window.clearTimeout(old);
  copyTimers.set(
    btn,
    window.setTimeout(() => {
      btn.setAttribute("data-state", "idle");
      copyTimers.delete(btn);
    }, ms),
  );
}

function onCopy(btn: HTMLElement): void {
  if (btn.getAttribute("aria-busy") === "true") return;
  const value = btn.getAttribute("data-copy") ?? "";
  const fallback = () => {
    const row = btn.closest(".id-row, .sd-copyable, .flow-item, .site-footer");
    selectText(row ? row.querySelector("h1, h2, .sd-id") : null);
    showCopy(btn, "fallback", FALLBACK_MS);
  };
  const clip = navigator.clipboard;
  if (!clip || typeof clip.writeText !== "function") return fallback();
  let pending: Promise<void>;
  try {
    pending = clip.writeText(value);
  } catch {
    return fallback();
  }
  // One write at a time per button: a click while one is pending does nothing.
  btn.setAttribute("aria-busy", "true");
  const settle = () => btn.removeAttribute("aria-busy");
  pending.then(
    () => {
      settle();
      showCopy(btn, "done", COPIED_MS);
    },
    () => {
      settle();
      fallback();
    },
  );
}

// "?" opens the shortcut list and moves focus to it; "?" again closes it.
function openShortcuts(): boolean {
  const d = document.querySelector<HTMLDetailsElement>("details.shortcuts");
  if (!d) return false;
  const summary = d.querySelector<HTMLElement>("summary");
  if (d.open && d.contains(document.activeElement)) {
    d.open = false;
    if (summary) summary.focus();
    return true;
  }
  d.open = true;
  if (summary) summary.focus();
  announce(ui.shortcuts.opened);
  return true;
}

function go(): void {
  for (const shot of Array.from(document.querySelectorAll<HTMLElement>(".shot"))) watchShot(shot);
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(".flow-card img")))
    watchThumb(img);
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
    live.textContent = stepAnnouncement(to, items.length, heading.textContent ?? "", ui);
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
  if (action.kind === "help") return openShortcuts();
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
  const copy = t ? t.closest<HTMLElement>("button.sd-copy") : null;
  if (copy) onCopy(copy);
  if (t && t.closest(".sd-ann")) return;
  for (const w of Array.from(document.querySelectorAll(".sd-ann.sd-open")))
    w.classList.remove("sd-open");
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("click", onDocumentClick);
// Halo and callout positions are pixels of the displayed image, so a width change (rotating a
// phone, resizing the window) redraws the overlays near the viewport whose width changed, once per
// frame. A far shot keeps its old drawing and is redrawn when it comes near (its shot.dataset.drawnWidth
// no longer matches).
function onResize(): void {
  const shots = io
    ? (Array.from(nearShots) as HTMLElement[])
    : Array.from(document.querySelectorAll<HTMLElement>(".shot[data-anns]"));
  for (const shot of shots) queueShot(shot);
}

// A closed <details> prints as its summary only, so the write-ups open for printing and the
// ones that were closed close again afterwards.
let openedForPrint: HTMLDetailsElement[] = [];
function onBeforePrint(): void {
  openedForPrint = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details.write-up"),
  ).filter((d) => !d.open);
  for (const d of openedForPrint) d.open = true;
  // Every loaded shot prints with its overlay, drawn now: the print layout starts before a frame.
  printing = true;
  const shots = Array.from(document.querySelectorAll<HTMLElement>(".shot[data-anns]"));
  renderShots(shots.filter((shot) => needsRedraw(shotState(shot))));
}
function onAfterPrint(): void {
  for (const d of openedForPrint) d.open = false;
  openedForPrint = [];
  printing = false;
  onResize();
}

window.addEventListener("resize", onResize);
window.addEventListener("beforeprint", onBeforePrint);
window.addEventListener("afterprint", onAfterPrint);
// The script sits at the end of <body>, so every .shot is parsed; images still loading are
// handled by their own load event.
go();
