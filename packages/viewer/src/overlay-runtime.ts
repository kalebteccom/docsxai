// Browser-side overlay runtime for the interactive viewer.
//
// Imports the real `placeCallout` from placement.ts — the same function the static burner
// (burn.ts) uses — so callout placement has exactly one implementation. The package build
// (scripts/bundle-overlay.mjs) bundles this file with esbuild into dist/generated/overlay.js
// (IIFE, es2019, unminified for auditability); render.ts inlines that bundle into every
// emitted flow page.

import { placeCallout, type Side } from "./placement.js";
import type { AnnotationRecord } from "./annotations.js";

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
// (white-space:nowrap, wrap props neutralised) clamped to 280. Pass 2: height at that locked width.
function measureCallout(text: string): CalloutSize {
  const probe = document.createElement("div");
  probe.className = "sd-callout";
  probe.textContent = text;
  probe.style.cssText =
    "position:fixed;left:-99999px;top:0;display:block;visibility:hidden;" +
    "white-space:nowrap;overflow-wrap:normal;word-break:normal;width:auto;max-width:none";
  document.body.appendChild(probe);
  const cw = Math.min(probe.offsetWidth, 280);
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

  const halo = document.createElement("div");
  halo.className = "sd-halo";
  halo.style.cssText =
    "left:" + t.x + "px;top:" + t.y + "px;width:" + t.width + "px;height:" + t.height + "px";
  if (ann.copy) halo.title = label;
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
    if (ann.copy) badge.title = label;
    wrap.appendChild(badge);
  }

  if (ann.copy) {
    const co = document.createElement("div");
    co.className = "sd-callout";
    co.textContent = label;
    wrap.appendChild(co);
    const c = measureCallout(label);
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
  for (const ann of anns) renderOne(shot, ann, sx, sy, im);
}

function go(): void {
  for (const shot of Array.from(document.querySelectorAll(".shot[data-anns]"))) renderShot(shot);
}

if (document.readyState === "complete") go();
else window.addEventListener("load", go);
