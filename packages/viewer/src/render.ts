// Interactive docs-app generator.
//
// Given a doc pack's `docs/` tree — `<flow>/annotations.json`, `<flow>/screenshots/<step>.png`,
// optional `<flow>/<step>.md` — emit a self-contained static viewer: one HTML page per flow plus an
// index. Annotations (arrows + popups) are *not baked into the PNGs*; the page overlays them from the
// embedded `annotations.json` at render time, so they stay re-stylable.
//
// The overlay script inlined into each flow page is NOT maintained here: it is the esbuild bundle of
// src/overlay-runtime.ts (which imports the real placeCallout from placement.ts), emitted to
// dist/generated/overlay.js by scripts/bundle-overlay.mjs at package build time and read from disk
// at render time. Every page also carries a CSP meta that blocks all network egress — the emitted
// HTML is fully self-contained (inline style + script, workspace-local images, no CDN fetches).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { micromark } from "micromark";
import type { AnnotationRecord, AnnotationsFile } from "./annotations.js";

export interface BuildViewerOptions {
  /** The doc pack's `docs/` directory. */
  docsDir: string;
  /** Where to write the viewer (created if missing). */
  outDir: string;
  /** Restrict to these flow names; default = all flows found under `docsDir`. */
  flows?: string[];
}

export interface BuildViewerResult {
  /** Paths (relative to `outDir`) of the generated HTML pages, index first. */
  pages: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** For values inside a single-quoted HTML attribute: escape `&`, `<`, `>`, `'` — leave `"` (JSON uses it). */
const escAttrSingle = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}
async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Flow names under `docsDir` that carry an `annotations.json` (sorted). */
export async function discoverFlows(docsDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(docsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const flows: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && (await exists(path.join(docsDir, e.name, "annotations.json"))))
      flows.push(e.name);
  }
  return flows.sort();
}

const STYLE = `
  :root { font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1c1c1c; }
  body { margin: 0; padding: 2rem; max-width: 980px; margin-inline: auto; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  .step { margin: 1.5rem 0 2.5rem; }
  .shot { position: relative; display: inline-block; border: 1px solid #ddd; max-width: 100%; }
  .shot img { display: block; max-width: 100%; height: auto; }
  /* Default: a blinking halo around the target (+ a numbered badge when a screenshot has > 1 call-out) —
     does NOT cover the UI. The callout text is hidden until you hover the halo or its badge. */
  .sd-ann { position: absolute; left: 0; top: 0; pointer-events: none; }
  .sd-halo { position: absolute; box-sizing: border-box; border: 2px solid #e8590c; border-radius: 4px; box-shadow: 0 0 0 3px rgba(232,89,12,.35); animation: sd-pulse 1.7s ease-in-out infinite; cursor: help; pointer-events: auto; }
  @keyframes sd-pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(232,89,12,.35); } 50% { box-shadow: 0 0 0 8px rgba(232,89,12,.08); } }
  .sd-badge { position: absolute; min-width: 22px; height: 22px; padding: 0 6px; line-height: 22px; text-align: center; font-weight: 700; font-size: 12px; color: #fff; background: #e8590c; border: 2px solid #fff; border-radius: 11px; box-sizing: content-box; box-shadow: 0 2px 6px rgba(0,0,0,.32); pointer-events: auto; cursor: help; }
  .sd-callout, .sd-arrow { position: absolute; display: none; z-index: 3; pointer-events: none; }
  .sd-callout { background: #1c1c1c; color: #fff; padding: 8px 11px; border-radius: 7px; font-size: .85rem; line-height: 1.35; box-shadow: 0 4px 14px rgba(0,0,0,.32); overflow-wrap: anywhere; }
  .sd-arrow { width: 0; height: 0; }
  .sd-arrow.top { border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 8px solid #1c1c1c; }       /* callout above → arrow points down */
  .sd-arrow.bottom { border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 8px solid #1c1c1c; } /* callout below → arrow points up */
  .sd-arrow.left { border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-left: 8px solid #1c1c1c; }     /* callout left → arrow points right */
  .sd-arrow.right { border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-right: 8px solid #1c1c1c; }   /* callout right → arrow points left */
  .sd-ann:hover .sd-callout, .sd-ann:hover .sd-arrow { display: block; }
  .caption { color: #555; font-size: 0.9rem; margin-top: 0.5rem; }
  ol.caption-list { color: #555; font-size: 0.9rem; margin: 0.5rem 0 0; padding-left: 1.5rem; }
  ol.caption-list li { margin: 0.15rem 0; }
  details { margin-top: 0.5rem; } pre { white-space: pre-wrap; background: #f6f6f6; padding: 0.75rem; border-radius: 6px; }
  .md { background: #f6f6f6; padding: 0.25rem 1rem; border-radius: 6px; font-size: 0.9rem; }
  .md h1, .md h2, .md h3, .md h4 { font-size: 1rem; margin: 0.75rem 0 0.25rem; }
  .md p, .md ul, .md ol { margin: 0.5rem 0; }
  .md pre { background: #ececec; }
  .md code { background: #ececec; padding: 0 3px; border-radius: 3px; }
  nav a { display: block; padding: 0.25rem 0; }
  .meta { color: #888; font-size: 0.8rem; }
  .flow-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
  .flow-card { display: block; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; text-decoration: none; color: inherit; background: #fff; transition: box-shadow .15s; }
  .flow-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.12); }
  .flow-card img { display: block; width: 100%; height: 130px; object-fit: cover; object-position: top left; background: #f6f6f6; border-bottom: 1px solid #eee; }
  .flow-card .thumb-missing { height: 130px; display: grid; place-items: center; color: #999; font-size: .8rem; background: #f6f6f6; border-bottom: 1px solid #eee; }
  .flow-card-meta { padding: .6rem .75rem; } .flow-card-meta strong { display: block; } .flow-card-meta span { color: #777; font-size: .8rem; }
`;

// The overlay script (halo + badge + hover callout placement) is generated at build time from
// overlay-runtime.ts so the placement logic is single-sourced in placement.ts. Two candidate
// locations: ./generated/overlay.js next to the compiled render.js (the published-package case)
// and ../dist/generated/overlay.js relative to src/render.ts (running from source, e.g. vitest).
let overlayJsCache: string | undefined;
async function loadOverlayJs(): Promise<string> {
  if (overlayJsCache !== undefined) return overlayJsCache;
  const candidates = [
    new URL("./generated/overlay.js", import.meta.url),
    new URL("../dist/generated/overlay.js", import.meta.url),
  ];
  for (const url of candidates) {
    try {
      overlayJsCache = await fs.readFile(url, "utf8");
      return overlayJsCache;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "overlay bundle not found — run the viewer package build (scripts/bundle-overlay.mjs emits dist/generated/overlay.js)",
  );
}

// `file://` pages with inlined JS/CSS get cached hard by browsers — a re-render then looks
// stale on a normal reload. These metas + the visible "rendered <ts>" footer below let you
// see at a glance whether you're looking at a fresh render (and tell browsers not to cache).
const HEAD_NOCACHE =
  '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0">';

// Matches the inline-asset reality (inline <style>/<script>, local + data: images) while blocking
// all network egress from an emitted page — no CDN fetches, no beacons, no remote fonts.
const HEAD_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">";

function renderedFooter(renderedAt: string): string {
  return `<footer class="meta" style="margin-top:2rem;opacity:.6;font-size:.8rem">rendered ${esc(renderedAt)} — hard-reload (⌘⇧R) if this looks stale</footer>`;
}

function flowPageHtml(
  flow: string,
  steps: Array<{
    id: string;
    screenshot: string | null;
    anns: AnnotationRecord[];
    md: string | null;
  }>,
  renderedAt: string,
  overlayJs: string,
): string {
  const body = steps
    .map((s) => {
      const shot = s.screenshot
        ? `<div class="shot"${s.anns.length ? ` data-anns='${escAttrSingle(JSON.stringify(s.anns))}'` : ""}><img src="${esc(s.screenshot)}" alt="${esc(s.id)}"></div>`
        : `<p class="meta">(no screenshot for step ${esc(s.id)})</p>`;
      const cap =
        s.anns.length === 0
          ? ""
          : s.anns.length === 1
            ? `<div class="caption">${esc(s.anns[0]!.copy)}</div>`
            : `<ol class="caption-list">${s.anns.map((a) => `<li>${esc(a.copy)}</li>`).join("")}</ol>`;
      // micromark in its safe default mode: raw HTML in the markdown is escaped, dangerous link
      // protocols are dropped — nothing in a step write-up can introduce markup or script.
      const md = s.md
        ? `<details><summary>Step write-up</summary><div class="md">${micromark(s.md)}</div></details>`
        : "";
      return `<section class="step"><h2>${esc(s.id)}</h2>${shot}${cap}${md}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${HEAD_CSP}${HEAD_NOCACHE}<title>${esc(flow)}</title><style>${STYLE}</style></head>
<body><p><a href="../index.html">← all flows</a></p><h1>${esc(flow)}</h1>${body}${renderedFooter(renderedAt)}<script>${overlayJs}</script></body></html>`;
}

interface FlowSummary {
  flow: string;
  steps: number;
  annotations: number;
  /** Path (relative to the viewer root) of a representative screenshot, or `null` if the flow has none. */
  thumb: string | null;
}

function indexHtml(meta: FlowSummary[], renderedAt: string): string {
  const cards = meta
    .map((m) => {
      const img = m.thumb
        ? `<img src="${esc(m.thumb)}" alt="">`
        : `<div class="thumb-missing">no screenshot</div>`;
      const sub = `${m.steps} step${m.steps === 1 ? "" : "s"}${m.annotations ? `, ${m.annotations} annotation${m.annotations === 1 ? "" : "s"}` : ""}`;
      return `<a class="flow-card" href="${esc(m.flow)}/index.html">${img}<div class="flow-card-meta"><strong>${esc(m.flow)}</strong><span>${sub}</span></div></a>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${HEAD_CSP}${HEAD_NOCACHE}<title>Documentation</title><style>${STYLE}</style></head>
<body><h1>Documentation</h1>${cards ? `<div class="flow-grid">${cards}</div>` : "<p class='meta'>(no flows yet — run <code>docsxai run</code>, then <code>docsxai render</code>)</p>"}${renderedFooter(renderedAt)}</body></html>`;
}

/** Build the static viewer. Returns the generated page paths (relative to `outDir`), index first. */
export async function buildViewer(opts: BuildViewerOptions): Promise<BuildViewerResult> {
  const flows = opts.flows ?? (await discoverFlows(opts.docsDir));
  await fs.mkdir(opts.outDir, { recursive: true });
  const renderedAt = new Date().toISOString();
  const overlayJs = flows.length ? await loadOverlayJs() : "";
  const pages: string[] = ["index.html"];
  const flowSummaries: FlowSummary[] = [];

  for (const flow of flows) {
    const flowSrc = path.join(opts.docsDir, flow);
    const annFile = await readJsonIfExists<AnnotationsFile>(path.join(flowSrc, "annotations.json"));
    const annsByStep = new Map<string, AnnotationRecord[]>();
    for (const a of annFile?.annotations ?? []) {
      const list = annsByStep.get(a.step) ?? [];
      list.push(a);
      annsByStep.set(a.step, list);
    }

    // Step order: first occurrence of each step in the annotation list (multi-annotation steps appear once);
    // else fall back to the screenshot filenames.
    let stepIds = [...new Set((annFile?.annotations ?? []).map((a) => a.step))];
    if (stepIds.length === 0) {
      const shots = await fs.readdir(path.join(flowSrc, "screenshots")).catch(() => [] as string[]);
      stepIds = shots
        .filter((s) => s.endsWith(".png"))
        .map((s) => s.replace(/\.png$/, ""))
        .sort();
    }

    const steps = [];
    for (const id of stepIds) {
      const shotRel = `screenshots/${id}.png`;
      const hasShot = await exists(path.join(flowSrc, shotRel));
      if (hasShot) {
        await fs.mkdir(path.join(opts.outDir, flow, "screenshots"), { recursive: true });
        await fs.copyFile(path.join(flowSrc, shotRel), path.join(opts.outDir, flow, shotRel));
      }
      steps.push({
        id,
        screenshot: hasShot ? shotRel : null,
        anns: annsByStep.get(id) ?? [],
        md: await readTextIfExists(path.join(flowSrc, `${id}.md`)),
      });
    }

    await fs.mkdir(path.join(opts.outDir, flow), { recursive: true });
    await fs.writeFile(
      path.join(opts.outDir, flow, "index.html"),
      flowPageHtml(flow, steps, renderedAt, overlayJs),
      "utf8",
    );
    pages.push(`${flow}/index.html`);

    const thumbStep = steps.find((s) => s.screenshot);
    flowSummaries.push({
      flow,
      steps: steps.length,
      annotations: steps.reduce((n, s) => n + s.anns.length, 0),
      thumb: thumbStep ? `${flow}/${thumbStep.screenshot}` : null,
    });
  }

  await fs.writeFile(
    path.join(opts.outDir, "index.html"),
    indexHtml(flowSummaries, renderedAt),
    "utf8",
  );
  return { pages };
}
