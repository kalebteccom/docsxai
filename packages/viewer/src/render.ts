// Interactive docs-app generator (Phase-0 prototype).
//
// Given a doc pack's `docs/` tree — `<flow>/annotations.json`, `<flow>/screenshots/<step>.png`,
// optional `<flow>/<step>.md` — emit a self-contained static viewer: one HTML page per flow plus an
// index. Annotations (arrows + popups) are *not baked into the PNGs*; the page overlays them from the
// embedded `annotations.json` at render time, so they stay re-stylable.
//
// (The portfolio spec says "Vitest-based viewer" — read that as "small, dependency-light, Vite/Vitest
// ecosystem"; this prototype is plain generated HTML+CSS+JS with zero build step. Revisit if it grows.)

import { promises as fs } from "node:fs";
import * as path from "node:path";

interface AnnotationRecord {
  step: string;
  selector: string;
  bounding_box?: { x: number; y: number; width: number; height: number };
  copy: string;
  arrow_style?: string;
}
interface AnnotationsFile {
  schema: string;
  flow: string;
  annotations: AnnotationRecord[];
}

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

async function discoverFlows(docsDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(docsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const flows: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && (await exists(path.join(docsDir, e.name, "annotations.json")))) flows.push(e.name);
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
  .box { position: absolute; border: 2px solid #e8590c; border-radius: 3px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.03); pointer-events: none; }
  .callout { position: absolute; background: #1c1c1c; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 0.85rem; max-width: 260px; }
  .callout::after { content: ""; position: absolute; border: 6px solid transparent; }
  .callout.top::after { border-bottom-color: #1c1c1c; top: -12px; left: 12px; }
  .callout.bottom::after { border-top-color: #1c1c1c; bottom: -12px; left: 12px; }
  .callout.left::after { border-right-color: #1c1c1c; left: -12px; top: 10px; }
  .callout.right::after { border-left-color: #1c1c1c; right: -12px; top: 10px; }
  .caption { color: #555; font-size: 0.9rem; margin-top: 0.5rem; }
  details { margin-top: 0.5rem; } pre { white-space: pre-wrap; background: #f6f6f6; padding: 0.75rem; border-radius: 6px; }
  nav a { display: block; padding: 0.25rem 0; }
  .meta { color: #888; font-size: 0.8rem; }
`;

// Inlined at the bottom of each flow page; positions overlays from the embedded annotations data.
const OVERLAY_JS = `
(function () {
  function place() {
    document.querySelectorAll(".shot[data-ann]").forEach(function (shot) {
      var img = shot.querySelector("img");
      if (!img || !img.naturalWidth) return;
      var ann = JSON.parse(shot.getAttribute("data-ann") || "null");
      if (!ann || !ann.bounding_box) return;
      var bb = ann.bounding_box;
      var sx = img.clientWidth / img.naturalWidth, sy = img.clientHeight / img.naturalHeight;
      var box = document.createElement("div");
      box.className = "box";
      box.style.left = (bb.x * sx) + "px"; box.style.top = (bb.y * sy) + "px";
      box.style.width = (bb.width * sx) + "px"; box.style.height = (bb.height * sy) + "px";
      shot.appendChild(box);
      if (ann.copy) {
        var side = (ann.arrow_style || "top").split("-")[0]; // top|bottom|left|right
        var c = document.createElement("div");
        c.className = "callout " + (["top","bottom","left","right"].indexOf(side) >= 0 ? side : "top");
        c.textContent = ann.copy;
        var left = bb.x * sx, top = bb.y * sy;
        if (side === "top") top -= 44;
        else if (side === "bottom") top += bb.height * sy + 12;
        else if (side === "left") left -= 280;
        else if (side === "right") left += bb.width * sx + 12;
        c.style.left = Math.max(0, left) + "px"; c.style.top = Math.max(0, top) + "px";
        shot.appendChild(c);
      }
    });
  }
  if (document.readyState === "complete") place();
  else window.addEventListener("load", place);
})();
`;

function flowPageHtml(flow: string, steps: Array<{ id: string; screenshot: string | null; ann: AnnotationRecord | null; md: string | null }>): string {
  const body = steps
    .map((s) => {
      const shot = s.screenshot
        ? `<div class="shot"${s.ann ? ` data-ann='${escAttrSingle(JSON.stringify(s.ann))}'` : ""}><img src="${esc(s.screenshot)}" alt="${esc(s.id)}"></div>`
        : `<p class="meta">(no screenshot for step ${esc(s.id)})</p>`;
      const cap = s.ann?.copy ? `<div class="caption">${esc(s.ann.copy)}</div>` : "";
      const md = s.md ? `<details><summary>Step write-up</summary><pre>${esc(s.md)}</pre></details>` : "";
      return `<section class="step"><h2>${esc(s.id)}</h2>${shot}${cap}${md}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(flow)}</title><style>${STYLE}</style></head>
<body><p><a href="../index.html">← all flows</a></p><h1>${esc(flow)}</h1>${body}<script>${OVERLAY_JS}</script></body></html>`;
}

function indexHtml(flows: string[]): string {
  const links = flows.map((f) => `<a href="${esc(f)}/index.html">${esc(f)}</a>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docs</title><style>${STYLE}</style></head>
<body><h1>Documentation</h1><nav>${links || "<p class='meta'>(no flows)</p>"}</nav></body></html>`;
}

/** Build the static viewer. Returns the generated page paths (relative to `outDir`), index first. */
export async function buildViewer(opts: BuildViewerOptions): Promise<BuildViewerResult> {
  const flows = opts.flows ?? (await discoverFlows(opts.docsDir));
  await fs.mkdir(opts.outDir, { recursive: true });
  const pages: string[] = ["index.html"];

  for (const flow of flows) {
    const flowSrc = path.join(opts.docsDir, flow);
    const annFile = await readJsonIfExists<AnnotationsFile>(path.join(flowSrc, "annotations.json"));
    const annByStep = new Map<string, AnnotationRecord>((annFile?.annotations ?? []).map((a) => [a.step, a]));

    // Step order: annotation order if available, else screenshot files.
    let stepIds = (annFile?.annotations ?? []).map((a) => a.step);
    if (stepIds.length === 0) {
      const shots = await fs.readdir(path.join(flowSrc, "screenshots")).catch(() => [] as string[]);
      stepIds = shots.filter((s) => s.endsWith(".png")).map((s) => s.replace(/\.png$/, "")).sort();
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
        ann: annByStep.get(id) ?? null,
        md: await readTextIfExists(path.join(flowSrc, `${id}.md`)),
      });
    }

    await fs.mkdir(path.join(opts.outDir, flow), { recursive: true });
    await fs.writeFile(path.join(opts.outDir, flow, "index.html"), flowPageHtml(flow, steps), "utf8");
    pages.push(`${flow}/index.html`);
  }

  await fs.writeFile(path.join(opts.outDir, "index.html"), indexHtml(flows), "utf8");
  return { pages };
}
