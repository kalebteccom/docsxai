#!/usr/bin/env node
// Burn one raw screenshot with its annotations and print where each callout went and why: the side
// asked for and the side taken, every side's best score, the obstacles the callout, arrow, stem
// and badge touch, and how the connector is painted (triangle ink, fill or outline, or the line and its colour). For checking side hints against a real
// capture before committing them.
//
//   node scripts/burn-probe.mjs --screenshot raw.png --annotations raw.json \
//     [--theme <burn.theme JSON or file> | --workspace <dir>] [--step <name>] \
//     [--side 2=bottom ...] [--strict-side 1=top ...] [--out burned.png] [--json]
//
// `--annotations` reads a docsxai/annotations@1 file, a bare array of records, or a capture
// sidecar ({ width, height, annotations: [{ index, copy, bbox, obstacles }] }). `--side` sets the
// soft hint (arrow_style) of the Nth annotation, `--strict-side` sets placement.side. Without a
// theme the burn is the unthemed look. It reads the built viewer, so run
// `pnpm --filter @docsxai/viewer build` first.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  applySides,
  askedSide,
  formatProbe,
  obstacleHits,
  parseSideOverride,
  toRecords,
} from "./burn-probe-plan.mjs";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/viewer/dist");

async function viewer(file) {
  try {
    return await import(pathToFileURL(resolve(DIST, file)).href);
  } catch (e) {
    throw new Error(
      `cannot load ${file} from ${DIST} (${e.message}); run "pnpm --filter @docsxai/viewer build"`,
    );
  }
}

async function themeFrom(values) {
  if (values.workspace) {
    const { loadBurnTheme } = await viewer("burn-theme-load.js");
    const loaded = await loadBurnTheme(resolve(values.workspace));
    if (!loaded) return { theme: undefined, label: `none (${values.workspace} has no burn.theme)` };
    for (const w of loaded.warnings) console.error(`warning: ${w}`);
    return { theme: loaded.theme, label: `from ${values.workspace}` };
  }
  if (values.theme) {
    const text = values.theme.trim().startsWith("{")
      ? values.theme
      : await readFile(values.theme, "utf8");
    const { parseThemeConfig, resolveBurnTheme } = await viewer("burn-theme-config.js");
    const config = parseThemeConfig(JSON.parse(text), "--theme");
    if (config.from !== undefined)
      throw new Error("--theme: use --workspace for a block with from");
    const workspace = values.theme.trim().startsWith("{") ? process.cwd() : dirname(values.theme);
    return { theme: resolveBurnTheme(config, { workspace }, "--theme"), label: text.trim() };
  }
  return { theme: undefined, label: "none" };
}

async function metricsFor(theme) {
  const { loadThemeFont } = await viewer("burn-theme-load.js");
  const { parseFontMetrics } = await viewer("font-metrics.js");
  const themed = theme ? await loadThemeFont(theme) : undefined;
  if (themed) return themed.metrics;
  return parseFontMetrics(await readFile(resolve(DIST, "../assets/fonts/inter-regular.ttf")));
}

/**
 * How the connector of a real-size layout is painted on these pixels: ink, fill or outline for the
 * triangle, `line <colour>` or `chevron <colour>` for the thin line.
 */
function paintOf(layout, pixels, theme, mods, themed) {
  const { layoutBoxes } = mods.callout;
  const { connectorPaint, toneOf, CONNECTOR_HALO, averageHex } = mods.contrast;
  const { connectorColor, DEFAULT_BURN_THEME } = mods.theme;
  const boxes = layoutBoxes(layout).slice(1);
  if (boxes.length === 0) return "none";
  const t = theme ?? DEFAULT_BURN_THEME;
  const style = mods.line.drawnStyle(t.connectorStyle, themed);
  if (style !== "arrow") {
    const stroke = mods.line.LINE_STROKE * mods.scale;
    const path = mods.line.linePath(layout, t.radius * mods.scale + stroke);
    if (!path) return "none";
    const under = averageHex(pixels, mods.line.pathBoxes(path, stroke));
    return `${style} ${mods.line.lineColor(mods.theme.scaledTheme(t, mods.scale), under)}`;
  }
  const grow = CONNECTOR_HALO * mods.scale;
  const grown = boxes.map((b) => ({
    x: b.x - grow,
    y: b.y - grow,
    width: b.width + 2 * grow,
    height: b.height + 2 * grow,
  }));
  const fillTone = themed ? toneOf(t.calloutBackground) : undefined;
  return connectorPaint(pixels, grown, toneOf(connectorColor(t)), fillTone);
}

async function main() {
  const { values } = parseArgs({
    options: {
      screenshot: { type: "string" },
      annotations: { type: "string" },
      theme: { type: "string" },
      workspace: { type: "string" },
      step: { type: "string" },
      side: { type: "string", multiple: true },
      "strict-side": { type: "string", multiple: true },
      out: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (!values.screenshot || !values.annotations) {
    console.error("usage: burn-probe.mjs --screenshot <png> --annotations <json> [options]");
    return 2;
  }
  const png = await readFile(values.screenshot);
  const raw = JSON.parse(await readFile(values.annotations, "utf8"));
  const overrides = [
    ...(values.side ?? []).map((s) => parseSideOverride(s)),
    ...(values["strict-side"] ?? []).map((s) => parseSideOverride(s, true)),
  ];
  const records = applySides(toRecords(raw, values.step ? { step: values.step } : {}), overrides);
  const { theme, label } = await themeFrom(values);

  const burn = await viewer("burn.js");
  const mods = {
    callout: await viewer("burn-callout.js"),
    contrast: await viewer("connector-contrast.js"),
    line: await viewer("burn-line.js"),
    theme: await viewer("burn-theme.js"),
  };
  const { layoutAtScale } = await viewer("burn-scale.js");
  const { decodeScreenshot } = await viewer("screenshot-pixels.js");
  const { width, height } = burn.pngDimensions(png);
  const pixels = decodeScreenshot(png, width, height);
  const trace = [];
  burn.buildBurnTree({
    image: { width, height, dataUri: "data:image/png;base64," },
    annotations: records,
    metrics: await metricsFor(theme),
    ...(theme ? { theme } : {}),
    trace,
  });
  const rendered = await burn.renderBurn({
    screenshotBuffer: png,
    annotations: records,
    options: { ...(theme ? { theme } : {}), warn: (m) => console.error(m) },
  });
  if (values.out) await writeFile(values.out, rendered.png);

  const scale = mods.theme.captionScale(theme ?? mods.theme.DEFAULT_BURN_THEME, width);
  const annotations = records.map((record, i) => {
    const report = rendered.report[i];
    const t = trace.find((e) => e.position === i);
    const real = t ? layoutAtScale(t.layout, t.scale) : null;
    const boxes = real ? mods.callout.layoutBoxes(real) : [];
    const arrow = real?.side && real.arrow ? boxes[1] : null;
    const stem = real?.stem ? boxes.at(-1) : null;
    return {
      position: i + 1,
      copy: record.copy ?? "",
      asked: askedSide(record),
      mode: report.mode,
      side: report.side,
      callout: report.callout,
      badge: report.badge,
      lines: real?.lines ?? [],
      stem: real?.stem ? Math.round(Math.max(real.stem.width, real.stem.height)) : 0,
      connector: real ? paintOf(real, pixels, theme, { ...mods, scale: t.scale }, !!theme) : "none",
      obstacleOverlap: report.obstacle_overlap,
      otherOverlap: report.other_overlap,
      ratio: report.overlap_ratio,
      unplaceable: report.unplaceable,
      hits: obstacleHits(
        { callout: report.callout, arrow, stem, badge: report.badge },
        record.obstacles,
      ),
      verdicts: t ? mods.callout.explainLayout(t.input, t.layout) : [],
      ...(report.skipped ? { skipped: report.skipped } : {}),
    };
  });
  const probe = { image: { width, height }, theme: label, scale, annotations };
  process.stdout.write(values.json ? `${JSON.stringify(probe, null, 2)}\n` : formatProbe(probe));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`burn-probe: ${e.message}`);
    process.exit(1);
  },
);
