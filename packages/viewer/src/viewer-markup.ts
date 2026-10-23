// Page markup for the interactive viewer: pure string builders, no IO. render.ts loads the doc
// pack and hands the data here; tests call these builders directly with a fixed timestamp.

import { micromark } from "micromark";
import type { AnnotationRecord } from "./annotations.js";
import { SHORTCUTS } from "./viewer-keys.js";
import { copyButton } from "./viewer-copy.js";
import { VIEWER_STYLE } from "./viewer-style.js";
import type { ThemeStyle } from "./burn-theme-css.js";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** For values inside a single-quoted HTML attribute: escape `&`, `<`, `>`, `'` — leave `"` (JSON uses it). */
const escAttrSingle = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

// `file://` pages with inlined JS/CSS get cached hard by browsers — a re-render then looks
// stale on a normal reload. These metas ask browsers not to cache; the footer names the viewer
// build and carries no clock, so rendering the same pack twice gives byte-identical pages.
const HEAD_NOCACHE =
  '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0">';

// Matches the inline-asset reality (inline <style>/<script>, local + data: images) while blocking
// all network egress from an emitted page — no CDN fetches, no beacons, no remote fonts.
const CSP_BASE =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
const cspMeta = (policy: string) =>
  `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
const HEAD_CSP = cspMeta(CSP_BASE);
// A themed page that embeds the theme's font as a data: URI may load fonts from data: URIs, and from nowhere else.
const HEAD_CSP_FONT = cspMeta(`${CSP_BASE}; font-src data:`);

// Without a viewport meta, phones lay the page out at ~980 px and scale it down.
const HEAD_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** Site name shown in every page title and on the index heading. */
export const SITE_TITLE = "Documentation";

function pageHead(title: string, theme?: ThemeStyle): string {
  const csp = theme?.embedsFont ? HEAD_CSP_FONT : HEAD_CSP;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${HEAD_VIEWPORT}${csp}${HEAD_NOCACHE}<title>${esc(title)}</title><style>${VIEWER_STYLE}${theme?.css ?? ""}</style></head>`;
}

// `copy` is false on a page that ships no script (an empty index), where a button would do nothing.
function renderedFooter(stamp: string, copy = true): string {
  const button = copy ? ` ${copyButton(stamp, "viewer build")}` : "";
  return `<footer class="meta site-footer">Rendered by <span class="sd-id">${esc(stamp)}</span>. Hard-reload if this page looks stale.${button}</footer>`;
}

const SKIP_LINK = '<a class="skip-link" href="#main">Skip to content</a>';

/**
 * Step write-ups render inside a step whose heading is an `<h2>`, so the write-up's own headings
 * move down two levels (`#` becomes `<h3>`, capped at `<h6>`) to keep the page outline in order.
 */
export function demoteHeadings(html: string): string {
  return html.replace(
    /<(\/?)h([1-6])>/g,
    (_m, slash: string, n: string) => `<${slash}h${Math.min(6, Number(n) + 2)}>`,
  );
}

export interface ViewerStep {
  id: string;
  screenshot: string | null;
  /** Intrinsic PNG size, written as width/height so the image's box is reserved before it loads. */
  size?: { width: number; height: number } | null;
  anns: AnnotationRecord[];
  md: string | null;
  /** The id is not a safe file name, so no screenshot or write-up was read for it. */
  unsafe?: boolean;
}

function stepCaption(anns: AnnotationRecord[]): string {
  if (anns.length === 0) return "";
  if (anns.length === 1) return `<figcaption class="caption">${esc(anns[0]!.copy)}</figcaption>`;
  return `<figcaption><ol class="caption-list">${anns.map((a) => `<li>${esc(a.copy)}</li>`).join("")}</ol></figcaption>`;
}

// Shown by the runtime when the <img> fires `error`; Retry reloads it. The runtime rewrites the
// message while a retry runs and when it fails again.
function shotError(id: string, rel: string): string {
  return `<p class="shot-error" role="alert" hidden><span class="shot-error-msg">The screenshot for step ${esc(id)} could not be loaded. Check that <code>${esc(rel)}</code> is still next to this page, then press Retry.</span> <button type="button" class="shot-retry">Retry</button></p>`;
}

// A step whose screenshot file does not exist: the reason and the command that captures it again.
function missingShot(id: string, flow: string | undefined): string {
  const cmd = `docsxai run <workspace>${flow ? ` --flow ${flow.split("/")[0]}` : ""} --start-from ${id}`;
  return `<div class="shot-missing" role="status"><p>No screenshot for this step. <code>screenshots/${esc(id)}.png</code> was not found when this page was built.</p><p>Capture it again with <span class="sd-copyable"><code class="sd-id">${esc(cmd)}</code> ${copyButton(cmd, "command")}</span> then run <code>docsxai render &lt;workspace&gt;</code>.</p></div>`;
}

function stepShot(s: ViewerStep, flow: string | undefined): string {
  if (s.unsafe)
    return `<p class="shot-missing" role="alert">This step's name cannot be used as a file name, so its screenshot and write-up were left out. Rename the step in the flow file, then run <code>docsxai run</code> and <code>docsxai render</code> again.</p>`;
  if (!s.screenshot) return missingShot(s.id, flow);
  const dims = s.size ? ` width="${s.size.width}" height="${s.size.height}"` : "";
  const data = s.anns.length ? ` data-anns='${escAttrSingle(JSON.stringify(s.anns))}'` : "";
  return `<div class="shot"${data}><img src="${esc(s.screenshot)}" alt="Screenshot of step ${esc(s.id)}"${dims}></div>${shotError(s.id, s.screenshot)}`;
}

/** One step: a labelled section, focusable from script so keyboard navigation can land on it. */
export function stepHtml(s: ViewerStep, n: number, flow?: string): string {
  // micromark in its safe default mode: raw HTML in the markdown is escaped, dangerous link
  // protocols are dropped — nothing in a step write-up can introduce markup or script.
  const md = s.md
    ? `<details class="write-up"><summary>Step write-up</summary><div class="md">${demoteHeadings(micromark(s.md))}</div></details>`
    : "";
  const figure = `<figure class="shot-figure">${stepShot(s, flow)}${stepCaption(s.anns)}</figure>`;
  return `<section class="step" id="step-${n}" aria-labelledby="step-${n}-title" tabindex="-1"><div class="id-row"><h2 id="step-${n}-title">${esc(s.id)}</h2>${copyButton(s.id, "step id")}</div>${figure}${md}</section>`;
}

/** Neighbouring flows in the viewer's flow order, for the previous/next links and `[` / `]`. */
export interface FlowNeighbours {
  prev?: string;
  next?: string;
}

/** The documented shortcuts as a disclosure; the same table drives the key handler. */
export function shortcutsHtml(flowPage: boolean): string {
  const rows = SHORTCUTS.filter((s) => flowPage || !s.flowPageOnly)
    .map((s) => {
      const keys = s.display.map((k) => `<kbd>${esc(k)}</kbd>`).join(" or ");
      return `<div><dt>${keys}</dt><dd>${esc(s.description)}</dd></div>`;
    })
    .join("");
  const what = flowPage ? "steps" : "flows";
  return `<details class="shortcuts"><summary>Keyboard shortcuts</summary><p>Arrow keys and Home/End move between ${what}. Keys are ignored while you type in a field or hold Ctrl, Alt or Cmd.</p><dl>${rows}</dl></details>`;
}

const LIVE_REGION =
  '<div id="sd-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>';

function flowNav(flow: string, nb: FlowNeighbours): string {
  const up = "../".repeat(flow.split("/").length);
  const link = (rel: "prev" | "next", name: string) =>
    `<li><a rel="${rel}" href="${up}${esc(name)}/index.html">${rel === "prev" ? "Previous" : "Next"} flow: ${esc(name)}</a></li>`;
  const items = [
    `<li><a href="${up}index.html"><span aria-hidden="true">← </span>All flows</a></li>`,
    nb.prev !== undefined ? link("prev", nb.prev) : "",
    nb.next !== undefined ? link("next", nb.next) : "",
  ].join("");
  return `<nav aria-label="Flows"><ul class="flow-nav" role="list">${items}</ul></nav>`;
}

export interface FlowPageOptions {
  neighbours?: FlowNeighbours;
  /** Notes on a damaged annotations file, shown above the steps. */
  notices?: string[];
  /** The caption theme as page style (see burn-theme-css.ts); without it the page looks as it always did. */
  theme?: ThemeStyle;
}

const NO_STEPS =
  '<p class="empty">This flow has no steps yet. Capture it with <code>docsxai run</code>, then run <code>docsxai render</code> again.</p>';

export function flowPageHtml(
  flow: string,
  steps: ViewerStep[],
  stamp: string,
  overlayJs: string,
  opts: FlowPageOptions = {},
): string {
  const header = `<header class="site-header">${flowNav(flow, opts.neighbours ?? {})}${shortcutsHtml(true)}</header>`;
  const notices = (opts.notices ?? []).map((n) => `<p class="notice">${esc(n)}</p>`).join("");
  const body = steps.length ? steps.map((s, i) => stepHtml(s, i + 1, flow)).join("\n") : NO_STEPS;
  return `${pageHead(`${flow} · ${SITE_TITLE}`, opts.theme)}
<body>${SKIP_LINK}${header}<main id="main" tabindex="-1"><div class="id-row"><h1>${esc(flow)}</h1>${copyButton(flow, "flow id")}</div>${notices}${body}</main>${LIVE_REGION}${renderedFooter(stamp)}<script>${overlayJs}</script></body></html>`;
}

export interface FlowSummary {
  flow: string;
  steps: number;
  annotations: number;
  /** Path (relative to the viewer root) of a representative screenshot, or `null` if the flow has none. */
  thumb: string | null;
}

function flowCard(m: FlowSummary): string {
  const img = m.thumb
    ? `<img src="${esc(m.thumb)}" alt="" loading="lazy" decoding="async">`
    : `<div class="thumb-missing">No screenshot yet. Open the flow to see how to capture it.</div>`;
  const sub = `${m.steps === 0 ? "No steps yet" : `${m.steps} step${m.steps === 1 ? "" : "s"}`}${m.annotations ? `, ${m.annotations} annotation${m.annotations === 1 ? "" : "s"}` : ""}`;
  return `<li class="flow-item"><a class="flow-card" href="./${esc(m.flow)}/index.html">${img}<div class="flow-card-meta"><strong class="sd-id">${esc(m.flow)}</strong><span>${sub}</span></div></a>${copyButton(m.flow, "flow id")}</li>`;
}

export function indexHtml(meta: FlowSummary[], stamp: string, overlayJs = ""): string {
  const list = meta.length
    ? `<ul class="flow-grid" role="list">${meta.map(flowCard).join("\n")}</ul>`
    : `<p class="empty">No flows yet. Run <code>docsxai run</code>, then <code>docsxai render</code>.</p>`;
  const header = meta.length ? `<header class="site-header">${shortcutsHtml(false)}</header>` : "";
  const script = overlayJs ? `<script>${overlayJs}</script>` : "";
  const live = meta.length ? LIVE_REGION : "";
  return `${pageHead(SITE_TITLE)}
<body>${SKIP_LINK}${header}<main id="main" tabindex="-1"><h1>${SITE_TITLE}</h1>${list}</main>${live}${renderedFooter(stamp, meta.length > 0)}${script}</body></html>`;
}
