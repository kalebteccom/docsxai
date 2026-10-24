#!/usr/bin/env node
// Burns every frame of a raw capture directory with the caption theme and writes burned previews
// plus a markdown report of how each caption, connector and badge landed.
//
//   node scripts/burn-probe-batch.mjs --raw <dir> --out <dir> [--tokens-dark <file>]
//     [--tokens-light <file>] [--theme dark|light] [--locale en|es] [--widths 1280,390]
//
// `--raw` is read in either layout, detected from the file names (anything else is ignored):
//   flat     <screen>.<locale>.<theme>.<width>.png with a .json sidecar beside it
//            (trackxai/raw-capture-sidecar@1, annotations with bounding_box)
//   rawcap   <flow>/<step>/<locale>.<theme>.<viewport>.png with a .json sidecar beside it
//            ({ width, height, annotations: [{ index, copy, bbox, obstacles, ... }] })
// Frames are those of `--theme` (default dark), `--locale` (default en) and `--widths` (default
// 1280,390). The tokens file is `--tokens-<theme>`, else examples/burn-theme/trackxai-<theme>.tokens.json.
// Captures under 900 px burn with `caption_style: "auto"`, the others with `full`, as
// burn-trackxai.mjs does.
//
// Writes <out>/previews/<frame>.png (a rawcap frame is named <flow>__<step>__<locale>.<theme>.<viewport>.png)
// and <out>/report.md: the CHECK rows first, a summary, then one row per frame and annotation.
// It reads the built viewer, so run `pnpm --filter @docsxai/viewer build` first.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  detectLayout,
  formatReport,
  frameRows,
  listFrames,
  previewName,
  readSidecar,
  selectFrames,
} from "./burn-probe-batch-plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = join(ROOT, "packages/viewer/dist");
const EXAMPLES = join(ROOT, "examples/burn-theme");
const TOKEN_MAP = { scale: "render.scale", display_width: "render.display-width" };

const viewer = (file) => import(pathToFileURL(join(VIEWER, file)).href);

async function themeFor(tokensFile) {
  const { parseThemeConfig, resolveBurnTheme } = await viewer("burn-theme-config.js");
  const { flattenTokens } = await viewer("burn-theme-tokens.js");
  const workspace = dirname(tokensFile);
  const from = tokensFile.slice(workspace.length + 1);
  const tokens = flattenTokens(JSON.parse(await readFile(tokensFile, "utf8")));
  // A tokens file without the render keys burns at the defaults.
  const map = Object.fromEntries(Object.entries(TOKEN_MAP).filter(([, path]) => tokens.has(path)));
  return resolveBurnTheme(
    parseThemeConfig({ from, ...(Object.keys(map).length > 0 ? { tokens: map } : {}) }, from),
    { workspace, tokens },
    from,
  );
}

async function burnFrame(frame, raw, theme, mods) {
  const sidecarFile = join(raw, frame.json);
  let doc;
  try {
    doc = JSON.parse(await readFile(sidecarFile, "utf8"));
  } catch (e) {
    throw new Error(`${frame.json}: ${e.code === "ENOENT" ? "missing" : e.message}`);
  }
  const { records } = readSidecar(doc, frame.json, frame);
  const png = await readFile(join(raw, frame.png));
  const { width, height } = mods.burn.pngDimensions(png);
  const themed = { ...theme, captionStyle: width < 900 ? "auto" : "full" };
  const font = await mods.load.loadThemeFont(themed);
  const metrics = font ? font.metrics : mods.defaultMetrics;
  const pixels = mods.pixels.decodeScreenshot(png, width, height);
  const report = [];
  const trace = [];
  mods.burn.buildBurnTree({
    image: { width, height, dataUri: "data:image/png;base64," },
    annotations: records,
    metrics,
    theme: themed,
    pixels,
    report,
    trace,
    warn: () => {},
  });
  const rendered = await mods.burn.renderBurn({
    screenshotBuffer: png,
    annotations: records,
    options: { theme: themed, warn: () => {} },
  });
  const connectors = records.map((record, i) => {
    const t = trace.find((e) => e.position === i);
    const stem = t ? mods.scale.layoutAtScale(t.layout, t.scale).stem : null;
    if (!stem) return { length: 0, crossing: 0 };
    return {
      length: Math.round(Math.max(stem.width, stem.height)),
      crossing: mods.placement.crossingLength(stem, record.obstacles ?? []),
    };
  });
  return {
    png: rendered.png,
    rows: frameRows(frame, records, report, connectors, { width, height }),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      raw: { type: "string" },
      out: { type: "string" },
      "tokens-dark": { type: "string" },
      "tokens-light": { type: "string" },
      theme: { type: "string", default: "dark" },
      locale: { type: "string", default: "en" },
      widths: { type: "string", default: "1280,390" },
    },
  });
  if (!values.raw || !values.out)
    throw new Error("usage: --raw <dir> --out <dir> (see the header)");
  if (!["dark", "light"].includes(values.theme)) throw new Error("--theme must be dark or light");
  const widths = values.widths.split(",").map(Number);
  if (widths.some((w) => !Number.isInteger(w) || w <= 0))
    throw new Error("--widths must be a comma list of pixel widths");
  const raw = resolve(values.raw);
  const out = resolve(values.out);
  const tokensFile = resolve(
    values[`tokens-${values.theme}`] ?? join(EXAMPLES, `trackxai-${values.theme}.tokens.json`),
  );

  const files = (await readdir(raw, { recursive: true })).map((f) => f.split("\\").join("/"));
  const all = listFrames(files);
  const frames = selectFrames(all, { theme: values.theme, locale: values.locale, widths });
  if (frames.length === 0) {
    throw new Error(
      `no frame in ${raw} matches ${values.theme}, ${values.locale}, widths ${widths.join(",")} (${all.length} frames in all)`,
    );
  }

  const theme = await themeFor(tokensFile);
  const { parseFontMetrics } = await viewer("font-metrics.js");
  const mods = {
    defaultMetrics: parseFontMetrics(
      await readFile(join(VIEWER, "../assets/fonts/inter-regular.ttf")),
    ),
    burn: await viewer("burn.js"),
    load: await viewer("burn-theme-load.js"),
    pixels: await viewer("screenshot-pixels.js"),
    scale: await viewer("burn-scale.js"),
    placement: await viewer("obstacle-placement.js"),
  };
  await mkdir(join(out, "previews"), { recursive: true });
  const rows = [];
  const errors = [];
  for (const frame of frames) {
    try {
      const burned = await burnFrame(frame, raw, theme, mods);
      await writeFile(join(out, "previews", previewName(frame)), burned.png);
      rows.push(...burned.rows);
    } catch (e) {
      errors.push({ frame: frame.label, message: e.message });
      console.error(`burn-probe-batch: ${frame.label}: ${e.message}`);
    }
  }
  const report = formatReport({
    meta: {
      layout: detectLayout(frames),
      theme: values.theme,
      locale: values.locale,
      widths,
      tokens: tokensFile,
    },
    rows,
    frames: frames.length,
    errors,
  });
  const reportFile = join(out, "report.md");
  await writeFile(reportFile, report);
  const check = rows.filter((r) => r.verdict === "CHECK").length;
  console.log(
    `${frames.length} frames, ${rows.length} annotations, ${check} CHECK, ${errors.length} failed`,
  );
  console.log(reportFile);
  return errors.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`burn-probe-batch: ${e.message}`);
    process.exit(1);
  },
);
