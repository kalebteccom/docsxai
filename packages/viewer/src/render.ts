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
import type { AnnotationRecord } from "./annotations.js";
import { isSafeFlowName, isSafeStepId, showName } from "./safe-id.js";
import { viewerStamp } from "./viewer-version.js";
import { flowPageHtml, indexHtml, type FlowSummary, type ViewerStep } from "./viewer-markup.js";

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
  /** Flows and steps left out because their name is not a safe path part. */
  warnings: string[];
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
export interface ParsedAnnotations {
  records: AnnotationRecord[];
  /** Reader-facing notes on a damaged file, rendered at the top of the flow page. */
  notices: string[];
}

const NO_CALLOUTS = "so this page shows the screenshots without call-outs.";

/**
 * The usable records of an `annotations.json` text (null when the file is absent). A damaged
 * file or record does not stop the render: what can be shown is shown, and the page says what
 * was left out. A record needs a non-empty `step` and a string `copy`.
 */
export function parseAnnotations(text: string | null): ParsedAnnotations {
  if (text === null) return { records: [], notices: [] };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { records: [], notices: [`annotations.json could not be parsed, ${NO_CALLOUTS}`] };
  }
  const list = (doc as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(list))
    return { records: [], notices: [`annotations.json has no annotations list, ${NO_CALLOUTS}`] };
  const records = list.filter(
    (a): a is AnnotationRecord =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as AnnotationRecord).step === "string" &&
      (a as AnnotationRecord).step !== "" &&
      typeof (a as AnnotationRecord).copy === "string",
  );
  const skipped = list.length - records.length;
  const notices = skipped
    ? [
        `${skipped} annotation record${skipped === 1 ? " was" : "s were"} skipped: each needs a step name and copy text.`,
      ]
    : [];
  return { records, notices };
}

/**
 * Width and height from a PNG's IHDR chunk (the first 24 bytes), or null when the file is not a
 * PNG. The viewer writes them on the <img> so the browser reserves the space before it loads.
 */
export async function pngSize(file: string): Promise<{ width: number; height: number } | null> {
  const fh = await fs.open(file, "r").catch(() => null);
  if (!fh) return null;
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(24), 0, 24, 0);
    const isPng =
      bytesRead === 24 &&
      buffer.readUInt32BE(0) === 0x89504e47 &&
      buffer.toString("latin1", 12, 16) === "IHDR";
    if (!isPng) return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } finally {
    await fh.close();
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

/**
 * Flow names under `docsDir` that carry an `annotations.json` (sorted). With `variants`, a flow
 * that ran a matrix also contributes one `<flow>/<variant>` name per subdirectory holding an
 * `annotations.json`; every consumer treats that name as a path under `docsDir`.
 */
export async function discoverFlows(
  docsDir: string,
  opts: { variants?: boolean } = {},
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(docsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const flows: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (await exists(path.join(docsDir, e.name, "annotations.json"))) flows.push(e.name);
    if (!opts.variants) continue;
    const subs = await fs
      .readdir(path.join(docsDir, e.name), { withFileTypes: true })
      .catch(() => [] as import("node:fs").Dirent[]);
    for (const sub of subs) {
      if (
        sub.isDirectory() &&
        (await exists(path.join(docsDir, e.name, sub.name, "annotations.json")))
      )
        flows.push(`${e.name}/${sub.name}`);
    }
  }
  return flows.sort();
}

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

/** Build the static viewer. Returns the generated page paths (relative to `outDir`), index first. */
export async function buildViewer(opts: BuildViewerOptions): Promise<BuildViewerResult> {
  const requested = opts.flows ?? (await discoverFlows(opts.docsDir, { variants: true }));
  const warnings: string[] = [];
  const flows = requested.filter((flow) => {
    if (isSafeFlowName(flow)) return true;
    warnings.push(
      `flow ${showName(flow)} skipped: a flow name cannot hold "..", ":", "\\" or control characters`,
    );
    return false;
  });
  await fs.mkdir(opts.outDir, { recursive: true });
  const stamp = viewerStamp();
  const overlayJs = flows.length ? await loadOverlayJs() : "";
  const pages: string[] = ["index.html"];
  const flowSummaries: FlowSummary[] = [];

  for (const [i, flow] of flows.entries()) {
    const flowSrc = path.join(opts.docsDir, flow);
    const parsed = parseAnnotations(await readTextIfExists(path.join(flowSrc, "annotations.json")));
    const annsByStep = new Map<string, AnnotationRecord[]>();
    for (const a of parsed.records) {
      const list = annsByStep.get(a.step) ?? [];
      list.push(a);
      annsByStep.set(a.step, list);
    }

    // Step order: first occurrence of each step in the annotation list (multi-annotation steps appear once);
    // else fall back to the screenshot filenames.
    let stepIds = [...new Set(parsed.records.map((a) => a.step))];
    if (stepIds.length === 0) {
      const shots = await fs.readdir(path.join(flowSrc, "screenshots")).catch(() => [] as string[]);
      stepIds = shots
        .filter((s) => s.endsWith(".png"))
        .map((s) => s.replace(/\.png$/, ""))
        .sort();
    }

    const steps: ViewerStep[] = [];
    for (const id of stepIds) {
      if (!isSafeStepId(id)) {
        warnings.push(
          `${flow}: step ${showName(id)} skipped: a step id cannot hold "/", "\\", "..", ":" or control characters`,
        );
        steps.push({ id, screenshot: null, anns: [], md: null, unsafe: true });
        continue;
      }
      const shotRel = `screenshots/${id}.png`;
      const hasShot = await exists(path.join(flowSrc, shotRel));
      if (hasShot) {
        await fs.mkdir(path.join(opts.outDir, flow, "screenshots"), { recursive: true });
        await fs.copyFile(path.join(flowSrc, shotRel), path.join(opts.outDir, flow, shotRel));
      }
      steps.push({
        id,
        screenshot: hasShot ? shotRel : null,
        size: hasShot ? await pngSize(path.join(flowSrc, shotRel)) : null,
        anns: annsByStep.get(id) ?? [],
        md: await readTextIfExists(path.join(flowSrc, `${id}.md`)),
      });
    }

    await fs.mkdir(path.join(opts.outDir, flow), { recursive: true });
    await fs.writeFile(
      path.join(opts.outDir, flow, "index.html"),
      flowPageHtml(flow, steps, stamp, overlayJs, {
        neighbours: { prev: flows[i - 1], next: flows[i + 1] },
        notices: parsed.notices,
      }),
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
    indexHtml(flowSummaries, stamp, overlayJs),
    "utf8",
  );
  return { pages, warnings };
}
