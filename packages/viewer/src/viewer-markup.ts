// Page markup for the interactive viewer: pure string builders, no IO. render.ts loads the doc
// pack and hands the data here; tests call these builders directly with a fixed timestamp.
// The text the page itself adds (labels, empty states, announcements) comes from ui-strings.ts in
// the page language: `lang` is a locale tag (`es`, `es-ES`), unknown tags give English.

import { micromark } from "micromark";
import type { AnnotationRecord } from "./annotations.js";
import { SHORTCUTS } from "./viewer-keys.js";
import { copyButton } from "./viewer-copy.js";
import { fmt, retryWidthCh, uiStrings, type UiStrings } from "./ui-strings.js";
import { VIEWER_STYLE } from "./viewer-style.js";
import type { ThemeStyle } from "./burn-theme-css.js";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * A relative path as a URL path: `%`, `#` and `?` are percent-encoded, so a name holding one still
 * names the file (a bare `#` or `?` would start the URL's fragment or query). Then HTML-escaped.
 */
const urlPath = (p: string) =>
  esc(
    p.replace(/[%#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`),
  );
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

/** Site name shown in every English page title and on the index heading. */
export const SITE_TITLE = uiStrings("en").siteTitle;

/** The Retry button width VIEWER_STYLE sets, in `ch`; a language whose labels need more adds a rule. */
const STYLE_RETRY_CH = 10;

// The button is as wide as its longer label (Retry or its working label), so a language with longer
// labels widens it after the base rule and before the theme.
function widthStyle(ui: UiStrings): string {
  const ch = retryWidthCh(ui);
  return ch === STYLE_RETRY_CH ? "" : `button.shot-retry { width: ${ch}ch; }`;
}

function pageHead(title: string, ui: UiStrings, theme?: ThemeStyle): string {
  const csp = theme?.embedsFont ? HEAD_CSP_FONT : HEAD_CSP;
  return `<!doctype html><html lang="${ui.lang}"><head><meta charset="utf-8">${HEAD_VIEWPORT}${csp}${HEAD_NOCACHE}<title>${esc(title)}</title><style>${VIEWER_STYLE}${widthStyle(ui)}${theme?.css ?? ""}</style></head>`;
}

// `copy` is false on a page that ships no script (an empty index), where a button would do nothing.
function renderedFooter(stamp: string, ui: UiStrings, copy = true): string {
  const button = copy ? ` ${copyButton(stamp, "viewer build", ui)}` : "";
  const built = fmt(ui.renderedBy, { stamp: `<span class="sd-id">${esc(stamp)}</span>` });
  return `<footer class="meta site-footer">${built}${button}</footer>`;
}

const skipLink = (ui: UiStrings) => `<a class="skip-link" href="#main">${ui.skipToContent}</a>`;

/** `docsxai run` and the other commands the page names, as code. */
const code = (cmd: string) => `<code>${cmd}</code>`;
const RUN = code("docsxai run");
const RENDER = code("docsxai render");

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
function shotError(id: string, rel: string, ui: UiStrings): string {
  const msg = fmt(ui.shot.errorMsg, { id: esc(id), file: code(esc(rel)) });
  return `<p class="shot-error" role="alert" hidden><span class="shot-error-msg">${msg}</span> <button type="button" class="shot-retry">${ui.shot.retry}</button></p>`;
}

// A step whose screenshot file does not exist: the reason and the command that captures it again.
function missingShot(id: string, flow: string | undefined, ui: UiStrings): string {
  const cmd = `docsxai run <workspace>${flow ? ` --flow ${flow.split("/")[0]}` : ""} --start-from ${id}`;
  const why = fmt(ui.shot.missingWhy, { file: code(`screenshots/${esc(id)}.png`) });
  const copyable = `<span class="sd-copyable"><code class="sd-id">${esc(cmd)}</code> ${copyButton(cmd, "command", ui)}</span>`;
  const how = fmt(ui.shot.missingHow, {
    command: copyable,
    render: code("docsxai render &lt;workspace&gt;"),
  });
  return `<div class="shot-missing" role="status"><p>${why}</p><p>${how}</p></div>`;
}

function stepShot(s: ViewerStep, flow: string | undefined, ui: UiStrings): string {
  if (s.unsafe)
    return `<p class="shot-missing" role="alert">${fmt(ui.shot.unsafe, { run: RUN, render: RENDER })}</p>`;
  if (!s.screenshot) return missingShot(s.id, flow, ui);
  const dims = s.size ? ` width="${s.size.width}" height="${s.size.height}"` : "";
  const data = s.anns.length ? ` data-anns='${escAttrSingle(JSON.stringify(s.anns))}'` : "";
  const alt = fmt(ui.step.shotAlt, { id: esc(s.id) });
  return `<div class="shot"${data}><img src="${urlPath(s.screenshot)}" alt="${alt}"${dims}></div>${shotError(s.id, s.screenshot, ui)}`;
}

function stepSection(s: ViewerStep, n: number, flow: string | undefined, ui: UiStrings): string {
  // micromark in its safe default mode: raw HTML in the markdown is escaped, dangerous link
  // protocols are dropped — nothing in a step write-up can introduce markup or script.
  const md = s.md
    ? `<details class="write-up"><summary>${ui.step.writeUp}</summary><div class="md">${demoteHeadings(micromark(s.md))}</div></details>`
    : "";
  const figure = `<figure class="shot-figure">${stepShot(s, flow, ui)}${stepCaption(s.anns)}</figure>`;
  return `<section class="step" id="step-${n}" aria-labelledby="step-${n}-title" tabindex="-1"><div class="id-row"><h2 id="step-${n}-title">${esc(s.id)}</h2>${copyButton(s.id, "step id", ui)}</div>${figure}${md}</section>`;
}

/** One step: a labelled section, focusable from script so keyboard navigation can land on it. */
export function stepHtml(s: ViewerStep, n: number, flow?: string, lang?: string): string {
  return stepSection(s, n, flow, uiStrings(lang));
}

/** Neighbouring flows in the viewer's flow order, for the previous/next links and `[` / `]`. */
export interface FlowNeighbours {
  prev?: string;
  next?: string;
}

function shortcutList(flowPage: boolean, ui: UiStrings): string {
  const t = ui.shortcuts;
  const rows = SHORTCUTS.filter((s) => flowPage || !s.flowPageOnly)
    .map((s) => {
      const keys = s.display.map((k) => `<kbd>${esc(t.keys[k] ?? k)}</kbd>`).join(t.or);
      return `<div><dt>${keys}</dt><dd>${esc(t.descriptions[s.description] ?? s.description)}</dd></div>`;
    })
    .join("");
  const what = flowPage ? t.whatSteps : t.whatFlows;
  return `<details class="shortcuts"><summary>${t.summary}</summary><p>${fmt(t.intro, { what })}</p><dl>${rows}</dl></details>`;
}

/** The documented shortcuts as a disclosure; the same table drives the key handler. */
export function shortcutsHtml(flowPage: boolean, lang?: string): string {
  return shortcutList(flowPage, uiStrings(lang));
}

const LIVE_REGION =
  '<div id="sd-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>';

function flowNav(flow: string, nb: FlowNeighbours, ui: UiStrings): string {
  const up = "../".repeat(flow.split("/").length);
  const link = (rel: "prev" | "next", name: string) =>
    `<li><a rel="${rel}" href="${up}${urlPath(name)}/index.html">${fmt(ui.nav[rel], { name: esc(name) })}</a></li>`;
  const items = [
    `<li><a href="${up}index.html"><span aria-hidden="true">← </span>${ui.nav.all}</a></li>`,
    nb.prev !== undefined ? link("prev", nb.prev) : "",
    nb.next !== undefined ? link("next", nb.next) : "",
  ].join("");
  return `<nav aria-label="${ui.nav.label}"><ul class="flow-nav" role="list">${items}</ul></nav>`;
}

export interface FlowPageOptions {
  neighbours?: FlowNeighbours;
  /** Notes on a damaged annotations file, shown above the steps. */
  notices?: string[];
  /** The caption theme as page style (see burn-theme-css.ts); without it the page looks as it always did. */
  theme?: ThemeStyle;
  /** Locale tag of the page (`es`, `es-ES`); the text the page adds is in that language. Default English. */
  lang?: string;
}

export function flowPageHtml(
  flow: string,
  steps: ViewerStep[],
  stamp: string,
  overlayJs: string,
  opts: FlowPageOptions = {},
): string {
  const ui = uiStrings(opts.lang);
  const header = `<header class="site-header">${flowNav(flow, opts.neighbours ?? {}, ui)}${shortcutList(true, ui)}</header>`;
  const notices = (opts.notices ?? []).map((n) => `<p class="notice">${esc(n)}</p>`).join("");
  const none = `<p class="empty">${fmt(ui.index.noSteps, { run: RUN, render: RENDER })}</p>`;
  const body = steps.length
    ? steps.map((s, i) => stepSection(s, i + 1, flow, ui)).join("\n")
    : none;
  return `${pageHead(`${flow} · ${ui.siteTitle}`, ui, opts.theme)}
<body>${skipLink(ui)}${header}<main id="main" tabindex="-1"><div class="id-row"><h1>${esc(flow)}</h1>${copyButton(flow, "flow id", ui)}</div>${notices}${body}</main>${LIVE_REGION}${renderedFooter(stamp, ui)}<script>${overlayJs}</script></body></html>`;
}

export interface FlowSummary {
  flow: string;
  steps: number;
  annotations: number;
  /** Path (relative to the viewer root) of a representative screenshot, or `null` if the flow has none. */
  thumb: string | null;
}

/** "3 steps, 1 annotation": counts with the language's singular and plural forms. */
function cardCounts(m: FlowSummary, ui: UiStrings): string {
  const i = ui.index;
  const steps =
    m.steps === 0 ? i.cardNoSteps : fmt(m.steps === 1 ? i.stepOne : i.stepMany, { n: m.steps });
  const anns = m.annotations
    ? `, ${fmt(m.annotations === 1 ? i.annOne : i.annMany, { n: m.annotations })}`
    : "";
  return steps + anns;
}

function flowCard(m: FlowSummary, ui: UiStrings): string {
  const img = m.thumb
    ? `<img src="${urlPath(m.thumb)}" alt="" loading="lazy" decoding="async">`
    : `<div class="thumb-missing">${ui.shot.thumbMissing}</div>`;
  const sub = cardCounts(m, ui);
  return `<li class="flow-item"><a class="flow-card" href="./${urlPath(m.flow)}/index.html">${img}<div class="flow-card-meta"><strong class="sd-id">${esc(m.flow)}</strong><span>${sub}</span></div></a>${copyButton(m.flow, "flow id", ui)}</li>`;
}

export function indexHtml(
  meta: FlowSummary[],
  stamp: string,
  overlayJs = "",
  lang?: string,
): string {
  const ui = uiStrings(lang);
  const list = meta.length
    ? `<ul class="flow-grid" role="list">${meta.map((m) => flowCard(m, ui)).join("\n")}</ul>`
    : `<p class="empty">${fmt(ui.index.noFlows, { run: RUN, render: RENDER })}</p>`;
  const header = meta.length
    ? `<header class="site-header">${shortcutList(false, ui)}</header>`
    : "";
  const script = overlayJs ? `<script>${overlayJs}</script>` : "";
  const live = meta.length ? LIVE_REGION : "";
  return `${pageHead(ui.siteTitle, ui)}
<body>${skipLink(ui)}${header}<main id="main" tabindex="-1"><h1>${ui.siteTitle}</h1>${list}</main>${live}${renderedFooter(stamp, ui, meta.length > 0)}${script}</body></html>`;
}
