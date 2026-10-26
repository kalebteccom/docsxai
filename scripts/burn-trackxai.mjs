#!/usr/bin/env node
// Burns trackxai raw captures with the trackxai caption theme into a screens pack.
//
//   node scripts/burn-trackxai.mjs --raw <dir> --out <dir> [--theme dark|light] [--locale en]
//     [--widths 1280,390] [--screens progress,board] [--rename tokens=agent-tokens,...]
//     [--manifest-in <manifest.json>] [--compare <dir>] [--webp] [--dpr 2]
//
// `--raw` holds `<screen>.<locale>.<theme>.<width>.png` with a `.json` sidecar beside each
// (schema docsxai/raw-capture-sidecar@1: `annotations[]` of burner records with `bounding_box`
// and `obstacles`). Each matching raw is burned with examples/burn-theme/trackxai-<theme>.tokens.json
// and written as `<out>/<desktop-W|mobile-W>/<name>.<hash>.png`, `<hash>` the first 8 hex of the
// PNG's SHA-256 and `<name>` the screen after `--rename`. `<out>/manifest.json`
// (docsxai/screens-pack@1) is merged: the burned variants are added or replaced, every other
// screen, variant and `alt` stays (read from `--manifest-in`, else the existing
// `<out>/manifest.json`). The PNG and WebP twin of a replaced variant are deleted. Two screens
// that burn to the same bytes with the same callouts point at one file. A bad sidecar
// stops the run with its file name. `--compare` also writes `before-` (no theme, the look burns
// had before themes) and `after-` PNGs there.
//
// `--badge-only board.390,ticket.en.dark.390` (and the `badge_only` list of
// scripts/burn-trackxai.overrides.json, or `--overrides <file>`) burns those frames as badges and
// rings only. `--keep-superseded` leaves replaced files in place (for a tree where they are tracked).
// Phone captures (under 900 px) burn with `caption_style: "auto"`: an annotation with no caption
// spot clear of text, header and bottom nav gets its badge only. Desktop captures keep captions.
//
// `--webp` also writes `<name>.<hash>.webp` beside each new PNG with `cwebp -lossless -z 9` (the
// `webp` package: `brew install webp`, `apt install webp`), and keeps it only when it is under
// 100 kB and smaller than the PNG; otherwise it removes the twin and prints a warning with both
// sizes. Without `cwebp` on PATH the run stops before burning anything.
//
// `--dpr <n>` says the raws are device pixels (default: the sidecar's `device_scale_factor`, else
// PNG width over the file name's CSS width). Sidecar boxes are read as PNG pixels, `display_width`
// stays in CSS px (so `scale: "auto"` gives 2560/1100 and 780/350), the phone chrome bands grow
// with the ratio, and a manifest entry keeps `width` and `height` in CSS px and adds
// `png_width` and `png_height`.
//
// It reads the built viewer, so run `pnpm --filter @docsxai/viewer build` first.

import { execFile, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  calloutTexts,
  checkSidecar,
  coverage,
  badgeOnly,
  badgeOnlyFrames,
  isBadgeOnly,
  contentHash,
  mergeManifest,
  parseRawName,
  parseRename,
  variantDir,
  cwebpArgs,
  captureRatio,
  variantValue,
  webpTwinPath,
  webpVerdict,
} from "./burn-trackxai-plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = join(ROOT, "packages/viewer/dist");
const EXAMPLES = join(ROOT, "examples/burn-theme");
const TOKEN_MAP = { scale: "render.scale", display_width: "render.display-width" };

const viewer = (file) => import(pathToFileURL(join(VIEWER, file)).href);

async function themeFor(mode) {
  const { parseThemeConfig, resolveBurnTheme } = await viewer("burn-theme-config.js");
  const { flattenTokens } = await viewer("burn-theme-tokens.js");
  const from = `trackxai-${mode}.tokens.json`;
  const tokens = flattenTokens(JSON.parse(await readFile(join(EXAMPLES, from), "utf8")));
  return resolveBurnTheme(
    parseThemeConfig({ from, tokens: TOKEN_MAP }, from),
    { workspace: EXAMPLES, tokens },
    from,
  );
}

function requireCwebp() {
  if (spawnSync("cwebp", ["-version"], { stdio: "ignore" }).status !== 0) {
    throw new Error(
      "--webp needs `cwebp` on PATH (the webp package: `brew install webp` or `apt install webp`)",
    );
  }
}

/** Write `<png>`'s lossless WebP twin; keep it only if it is small enough. Returns its path or null. */
async function writeWebpTwin(pngPath, pngBytes) {
  const twin = webpTwinPath(pngPath);
  await promisify(execFile)("cwebp", cwebpArgs(pngPath, twin));
  const verdict = webpVerdict(basename(pngPath), pngBytes, (await stat(twin)).size);
  if (verdict.keep) return twin;
  console.error(`warning: ${verdict.warning}`);
  await rm(twin, { force: true });
  return null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      raw: { type: "string" },
      out: { type: "string" },
      theme: { type: "string", default: "dark" },
      locale: { type: "string", default: "en" },
      widths: { type: "string", default: "1280,390" },
      screens: { type: "string" },
      rename: { type: "string" },
      "manifest-in": { type: "string" },
      compare: { type: "string" },
      "badge-only": { type: "string" },
      overrides: { type: "string" },
      "keep-superseded": { type: "boolean", default: false },
      webp: { type: "boolean", default: false },
      dpr: { type: "string" },
    },
  });
  if (!values.raw || !values.out)
    throw new Error("usage: --raw <dir> --out <dir> (see the header)");
  if (!["dark", "light"].includes(values.theme)) throw new Error("--theme must be dark or light");
  if (values.webp) requireCwebp();
  const raw = resolve(values.raw);
  const out = resolve(values.out);
  const widths = values.widths.split(",").map(Number);
  const only = values.screens ? values.screens.split(",") : null;
  const rename = parseRename(values.rename);
  const overridesFile = resolve(
    values.overrides ?? join(ROOT, "scripts/burn-trackxai.overrides.json"),
  );
  const overrides = existsSync(overridesFile)
    ? JSON.parse(await readFile(overridesFile, "utf8"))
    : null;
  const forced = badgeOnlyFrames(values["badge-only"], overrides);
  const { renderBurn } = await viewer("burn.js");
  const theme = await themeFor(values.theme);

  const files = (await readdir(raw))
    .map((name) => ({ name, parsed: parseRawName(name) }))
    .filter(({ parsed: p }) => p && p.locale === values.locale && p.theme === values.theme)
    .filter(({ parsed: p }) => widths.includes(p.width) && (!only || only.includes(p.screen)))
    .sort((a, b) => {
      const order = only ? only.indexOf(a.parsed.screen) - only.indexOf(b.parsed.screen) : 0;
      return order || a.name.localeCompare(b.name);
    });
  if (files.length === 0) throw new Error(`no raw PNG in ${raw} matches the filters`);

  const entries = [];
  const written = [];
  const shared = new Map();
  const legacyFiles = [];
  for (const { name, parsed } of files) {
    const sidecarFile = join(raw, name.replace(/\.png$/, ".json"));
    let doc;
    try {
      doc = JSON.parse(await readFile(sidecarFile, "utf8"));
    } catch (e) {
      throw new Error(`${sidecarFile}: ${e.code === "ENOENT" ? "missing" : e.message}`);
    }
    const { records, skipped, legacy } = checkSidecar(doc, sidecarFile, parsed);
    if (legacy) legacyFiles.push(name);
    for (const n of skipped) {
      console.error(`warning: ${name}: annotation ${n} has no bounding_box, skipped`);
    }
    const png = await readFile(join(raw, name));
    // Phone captures fall back to badges where no caption spot is clear; desktop keeps captions.
    const captionStyle = isBadgeOnly(forced, parsed)
      ? "badge"
      : parsed.width < 900
        ? "auto"
        : "full";
    const { pngDimensions } = await viewer("burn.js");
    const dims = pngDimensions(png);
    const dpr = captureRatio({
      flag: values.dpr,
      doc,
      cssWidth: parsed.width,
      pngWidth: dims.width,
      file: name,
    });
    const burned = await renderBurn({
      screenshotBuffer: png,
      annotations: records,
      options: { theme: { ...theme, captionStyle }, pixelRatio: dpr, warn: () => {} },
    });
    const shot = { width: dims.width, height: dims.height, dpr };
    for (const line of coverage(records, burned.report, shot)) {
      console.error(`check: ${name}: ${line}`);
    }
    const fell = badgeOnly(burned.report);
    if (fell.length > 0) console.error(`badge only: ${name}: annotation ${fell.join(", ")}`);
    const screen = rename.get(parsed.screen) ?? parsed.screen;
    const dir = variantDir(parsed.width);
    const callouts = calloutTexts(records);
    // Two screens that burn to the same bytes with the same callouts share one file.
    const key = `${dir}/${contentHash(burned.png)}/${JSON.stringify(callouts)}`;
    const file = shared.get(key) ?? `${screen}.${contentHash(burned.png)}.png`;
    if (!shared.has(key)) {
      shared.set(key, file);
      await mkdir(join(out, dir), { recursive: true });
      await writeFile(join(out, dir, file), burned.png);
      written.push(join(out, dir, file));
      if (values.webp) {
        const twin = await writeWebpTwin(join(out, dir, file), burned.png.length);
        if (twin) written.push(twin);
      }
    }
    entries.push({
      screen,
      variant: `${parsed.locale}.${parsed.theme}.${parsed.width}`,
      value: variantValue({
        src: `/screens/${dir}/${file}`,
        png: pngDimensions(burned.png),
        bytes: burned.png.length,
        callouts,
        dpr,
      }),
    });
    if (values.compare) {
      const cmp = resolve(values.compare);
      await mkdir(cmp, { recursive: true });
      const before = await renderBurn({
        screenshotBuffer: png,
        annotations: records,
        options: { pixelRatio: dpr, warn: () => {} },
      });
      const stem = name.replace(/\.png$/, "");
      await writeFile(join(cmp, `before-${stem}.png`), before.png);
      await writeFile(join(cmp, `after-${stem}.png`), burned.png);
      written.push(join(cmp, `after-${stem}.png`));
    }
  }

  const manifestPath = join(out, "manifest.json");
  const source = values["manifest-in"] ?? (existsSync(manifestPath) ? manifestPath : null);
  const previous = source ? JSON.parse(await readFile(source, "utf8")) : null;
  const { manifest, superseded } = mergeManifest(previous, entries);
  for (const src of superseded) {
    if (!src.startsWith("/screens/")) continue;
    if (values["keep-superseded"]) {
      console.error(`superseded (kept): ${src}`);
      continue;
    }
    const old = join(out, src.slice("/screens/".length));
    if (written.includes(old)) continue;
    await rm(old, { force: true });
    await rm(old.replace(/\.png$/, ".webp"), { force: true });
    console.error(`removed ${old} and its .webp twin`);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (legacyFiles.length > 0) {
    console.error(
      `note: ${legacyFiles.length} sidecar(s) use the schema name "trackxai/raw-capture-sidecar@1"; write "docsxai/raw-capture-sidecar@1" instead (the old name still works)`,
    );
  }
  for (const f of written) console.log(f);
  console.log(manifestPath);
}

main().catch((e) => {
  console.error(`burn-trackxai: ${e.message}`);
  process.exit(1);
});
