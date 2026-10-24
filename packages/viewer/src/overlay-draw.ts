// Drawing the viewer's overlay (halo, badge, callout, arrow) for a batch of shots. Split from
// overlay-runtime.ts, which bundles it; the redraw scheduling stays there. Imports the real
// `placeCallout` from placement.ts, the same function the static burner (burn.ts) uses, so callout
// placement has exactly one implementation.

import { placeCallout, type Side } from "./placement.js";
import type { AnnotationRecord } from "./annotations.js";
import { badgeOrigin } from "./overlay-geometry.js";

const SIDES: readonly string[] = ["top", "bottom", "left", "right"];

interface CalloutSize {
  width: number;
  height: number;
}

// Two-pass sizing on body-attached probes. A callout cannot be measured in place: when it is
// measured its wrapper is still detached from the document, and the .sd-callout class is
// display:none until :hover, so offsetWidth/Height would be 0 and bake width:0px. Each probe
// carries the same .sd-callout class (so padding/font/border match) and lives in the live render
// tree only for the reads. Every label of every shot being drawn is measured together: all probes
// go in, every width is read (one layout), the widths are locked, every height is read (one more
// layout), and the probes come out. Pass 1: natural single-line width (white-space:nowrap, wrap
// props neutralised) clamped to 280, or to the image width when the image is narrower (a phone),
// so the callout stays inside it. Pass 2: height at that locked width.
const PROBE_BASE = "position:fixed;left:-99999px;top:0;display:block;visibility:hidden;";

function measureCallouts(reqs: ReadonlyArray<{ text: string; maxWidth: number }>): CalloutSize[] {
  if (reqs.length === 0) return [];
  const probes = reqs.map((r) => {
    const probe = document.createElement("div");
    probe.className = "sd-callout";
    probe.textContent = r.text;
    probe.style.cssText =
      PROBE_BASE +
      "white-space:nowrap;overflow-wrap:normal;word-break:normal;width:auto;max-width:none";
    document.body.appendChild(probe);
    return probe;
  });
  const widths = probes.map((probe, i) => Math.min(probe.offsetWidth, reqs[i]!.maxWidth));
  probes.forEach((probe, i) => {
    probe.style.cssText = PROBE_BASE + "white-space:normal;width:" + widths[i] + "px";
  });
  const sizes = probes.map((probe, i) => ({ width: widths[i]!, height: probe.offsetHeight }));
  for (const probe of probes) document.body.removeChild(probe);
  return sizes;
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

/** The label a call-out shows and its halo announces: "2. Copy" when the shot is numbered. */
function annLabel(ann: AnnotationRecord): string {
  return (typeof ann.index === "number" ? ann.index + ". " : "") + ann.copy;
}

function renderOne(
  shot: Element,
  ann: AnnotationRecord,
  sx: number,
  sy: number,
  im: { width: number; height: number },
  c: CalloutSize | undefined,
): void {
  if (!ann.bounding_box) return;
  const bb = ann.bounding_box;
  const t = { x: bb.x * sx, y: bb.y * sy, width: bb.width * sx, height: bb.height * sy };
  const wrap = document.createElement("div");
  wrap.className = "sd-ann";
  const label = annLabel(ann);

  const halo = makeHalo(wrap, ann.copy ? label : "");
  halo.style.cssText =
    "left:" + t.x + "px;top:" + t.y + "px;width:" + t.width + "px;height:" + t.height + "px";
  wrap.appendChild(halo);

  // Numbered badge — only when this image has > 1 call-out (ann.index set by the engine then).
  if (typeof ann.index === "number") {
    const badge = document.createElement("div");
    badge.className = "sd-badge";
    badge.textContent = String(ann.index);
    // top-left of the halo, pulled slightly outside it; the whole badge stays inside the image
    const b = badgeOrigin(t, im);
    badge.style.cssText = "left:" + b.x + "px;top:" + b.y + "px";
    // The halo button carries the number in its label; the badge is a larger pointer target for it.
    badge.setAttribute("aria-hidden", "true");
    badge.addEventListener("click", () => halo.click());
    wrap.appendChild(badge);
  }

  if (ann.copy && c) {
    const co = document.createElement("div");
    co.className = "sd-callout";
    co.setAttribute("aria-hidden", "true");
    co.textContent = label;
    wrap.appendChild(co);
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

interface ShotPlan {
  shot: HTMLElement;
  anns: AnnotationRecord[];
  sx: number;
  sy: number;
  im: { width: number; height: number };
}

// Read pass for one shot: the annotations and the displayed size. No DOM writes.
function planShot(shot: HTMLElement): ShotPlan | null {
  const img = shot.querySelector("img");
  if (!img || !img.naturalWidth) return null;
  let anns: AnnotationRecord[];
  try {
    anns = JSON.parse(shot.getAttribute("data-anns") ?? "[]") as AnnotationRecord[];
  } catch {
    return null;
  }
  if (!Array.isArray(anns) || anns.length === 0) return null;
  const im = { width: img.clientWidth, height: img.clientHeight };
  return {
    shot,
    anns,
    sx: im.width / img.naturalWidth,
    sy: im.height / img.naturalHeight,
    im,
  };
}

// Draws the overlays of several shots in one read pass, one batched measurement and one write
// pass, so a frame costs two or three layouts however many shots it redraws.
export function renderShots(shots: HTMLElement[]): void {
  const plans = shots.map(planShot).filter((p): p is ShotPlan => p !== null);
  const reqs: Array<{ text: string; maxWidth: number }> = [];
  const slots = plans.map((p) =>
    p.anns.map((ann) => {
      if (!ann.bounding_box || !ann.copy) return -1;
      reqs.push({ text: annLabel(ann), maxWidth: Math.min(280, p.im.width) });
      return reqs.length - 1;
    }),
  );
  const sizes = measureCallouts(reqs);
  plans.forEach((p, i) => {
    for (const old of Array.from(p.shot.querySelectorAll(".sd-ann"))) p.shot.removeChild(old);
    p.shot.dataset.drawnWidth = String(p.im.width);
    p.anns.forEach((ann, j) => {
      const slot = slots[i]![j]!;
      renderOne(p.shot, ann, p.sx, p.sy, p.im, slot >= 0 ? sizes[slot] : undefined);
    });
  });
}
