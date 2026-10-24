#!/usr/bin/env node
// Draws the two product shots of the docsxai.dev landing page, each in dark and light at 1280 and
// 390 px wide, as hash-named PNGs with lossless WebP twins, plus the manifest the page reads.
//
//   node scripts/landing-showcase.mjs --raw <dir> --out website/public/showcase
//     [--screen progress] [--workspace <raw>/workspace]
//
// `pipeline`: one raw capture (`<raw>/<screen>.en.<theme>.<width>.png`) next to the same capture
// burned by scripts/burn-trackxai.mjs with the trackxai caption theme. 1280 puts them side by
// side, 390 stacks them.
// `terminal`: a window with what `docsxai run <workspace>` prints for a passing run of the
// workspace's flows. The lines follow the engine's own format (see runTranscript in
// landing-showcase-plan.mjs); the step counts come from the expanded flow files and the
// annotation counts from each variant's docs/<flow>/<variant>/annotations.json.
//
// The 1280 files are 1x. The 390 files are 2x: 780 px wide, shown at 390 CSS px, named
// `<shot>-<theme>-390x2.<hash8>.<ext>` and offered with a `2x` srcset descriptor. The 390 pipeline
// enlarges a 390 px capture, so its screenshots are softer than its labels; the terminal is
// vector text. At 390 the terminal prints one short row per variant (compactTranscript).
//
// Each picture is drawn with satori and resvg (the viewer's dependencies), reduced to a 256-colour
// palette with sharp (the website's), and twinned with `cwebp -lossless -z 9`. A PNG or WebP of
// 100 kB or more, or a WebP no smaller than its PNG, stops the run. The files are named
// `<shot>-<theme>-<width>[x2].<hash8>.<ext>`, `<hash8>` from the PNG's SHA-256; files of an earlier
// run that the new one does not write are removed. `<out>/manifest.json` lists each shot's
// <picture> sources for website/src/components/ShowcaseShot.astro.
//
// Needs `pnpm install`, `pnpm --filter @docsxai/viewer build`, `pnpm --filter @docsxai/engine
// build` and `cwebp` on PATH (`brew install webp`, `apt install webp`).

import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { cwebpArgs } from "./burn-trackxai-plan.mjs";
import {
  DENSITY,
  MAX_BYTES,
  THEMES,
  WIDTHS,
  assetName,
  compactTranscript,
  contentHash,
  pictureFor,
  pipelineLayout,
  runTranscript,
  staleFiles,
  wrapMono,
} from "./landing-showcase-plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromViewer = createRequire(join(ROOT, "packages/viewer/package.json"));
const fromWebsite = createRequire(join(ROOT, "website/package.json"));
const load = (req, id) => import(pathToFileURL(req.resolve(id)).href);
const engine = (file) => import(pathToFileURL(join(ROOT, "packages/engine/dist", file)).href);

// Brand-neutral greys for the before/after labels and frames.
const NEUTRAL = {
  dark: { label: "#2b2b2b", labelText: "#e4e4e4", frame: "rgba(255,255,255,0.16)" },
  light: { label: "#e9e9e9", labelText: "#2e2e2e", frame: "rgba(0,0,0,0.16)" },
};
// The terminal follows the site's own theme colours (website/src/styles/brand.css).
const TERM = {
  dark: {
    bg: "#1f1407",
    bar: "#170f05",
    border: "#38240f",
    dot: "#5c4831",
    text: "#f3e9d6",
    muted: "#b29d7c",
    accent: "#e9c465",
  },
  light: {
    bg: "#fffaf0",
    bar: "#f7efda",
    border: "#e3cf9f",
    dot: "#d6c39a",
    text: "#2a1d0b",
    muted: "#6f5c40",
    accent: "#7a4e0c",
  },
};

const h = (type, style, children) => ({ type, props: { style, children } });
const dataUri = (png) => `data:image/png;base64,${png.toString("base64")}`;

async function fonts() {
  const inter = await readFile(join(ROOT, "packages/viewer/assets/fonts/inter-regular.ttf"));
  const list = [{ name: "Inter", data: inter, weight: 400, style: "normal" }];
  const mono = join(ROOT, "website/node_modules/@fontsource/jetbrains-mono/files");
  for (const weight of [400, 500]) {
    const file = join(mono, `jetbrains-mono-latin-${weight}-normal.woff`);
    if (existsSync(file)) {
      list.push({ name: "Mono", data: await readFile(file), weight, style: "normal" });
    }
  }
  // Without the site's mono font the terminal falls back to Inter.
  if (list.length === 1) list.push({ name: "Mono", data: inter, weight: 400, style: "normal" });
  return list;
}

function burnScreen(raw, out, screen, theme) {
  const r = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts/burn-trackxai.mjs"),
      ...["--raw", raw, "--out", out, "--theme", theme, "--screens", screen],
      ...["--widths", WIDTHS.join(","), "--locale", "en"],
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`burn-trackxai (${theme}) failed:\n${r.stderr}`);
}

function pipelineTree({ width, theme, raw, burned, rawSize }) {
  const L = pipelineLayout(width);
  const c = NEUTRAL[theme];
  const fontSize = width === 1280 ? 14 : 12;
  const children = [];
  for (const p of L.panels) {
    const label = p.kind === "raw" ? "raw" : "burned";
    children.push(
      h(
        "div",
        {
          position: "absolute",
          left: p.x,
          top: p.y - L.label.gap - L.label.height,
          height: L.label.height,
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          borderRadius: 999,
          background: c.label,
          color: c.labelText,
          fontFamily: "Inter",
          fontSize,
        },
        label,
      ),
    );
    children.push(
      h(
        "div",
        {
          position: "absolute",
          left: p.x,
          top: p.y,
          width: p.width,
          height: p.height,
          display: "flex",
          overflow: "hidden",
          borderRadius: 10,
        },
        [
          {
            type: "img",
            props: {
              src: dataUri(p.kind === "raw" ? raw : burned),
              width: rawSize.width * L.scale,
              height: rawSize.height * L.scale,
              style: {
                position: "absolute",
                left: -L.crop.x * L.scale,
                top: -L.crop.y * L.scale,
                width: rawSize.width * L.scale,
                height: rawSize.height * L.scale,
              },
            },
          },
          h("div", {
            position: "absolute",
            left: 0,
            top: 0,
            width: p.width,
            height: p.height,
            borderRadius: 10,
            border: `1px solid ${c.frame}`,
          }),
        ],
      ),
    );
  }
  return {
    size: { width: L.width, height: L.height },
    tree: h(
      "div",
      { display: "flex", position: "relative", width: L.width, height: L.height },
      children,
    ),
  };
}

function terminalTree({ width, theme, command, lines }) {
  const c = TERM[theme];
  const wide = width === 1280;
  const fontSize = wide ? 19 : 13;
  const lineHeight = Math.round(fontSize * 1.6);
  const pad = wide ? 28 : 14;
  const bar = wide ? 46 : 32;
  // JetBrains Mono advances 0.6 em per character.
  const cols = Math.floor((width - pad * 2 - 2) / (fontSize * 0.6));
  const rows = [];
  rows.push({ kind: "prompt", text: command });
  lines.forEach((line, i) => {
    const kind = i === lines.length - 1 ? "summary" : "line";
    for (const text of wrapMono(line, cols)) rows.push({ kind, text });
  });
  const height = bar + pad * 2 + rows.length * lineHeight + 2;
  const row = ({ kind, text }) => {
    if (kind === "prompt") {
      return h("div", { display: "flex", height: lineHeight, alignItems: "center" }, [
        h("span", { color: c.accent, marginRight: fontSize * 0.6 }, "$"),
        h("span", { color: c.text, fontWeight: 500, whiteSpace: "pre" }, text),
      ]);
    }
    const tag = text.startsWith("run: ") ? "run:" : "";
    const body = tag ? text.slice(4) : text;
    return h("div", { display: "flex", height: lineHeight, alignItems: "center" }, [
      ...(tag ? [h("span", { color: c.muted, whiteSpace: "pre" }, tag)] : []),
      h(
        "span",
        {
          color: kind === "summary" ? c.accent : c.text,
          fontWeight: kind === "summary" ? 500 : 400,
          whiteSpace: "pre",
        },
        body,
      ),
    ]);
  };
  const dot = wide ? 13 : 9;
  const tree = h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width,
      height,
      borderRadius: wide ? 14 : 10,
      border: `1px solid ${c.border}`,
      background: c.bg,
      overflow: "hidden",
      fontFamily: "Mono",
      fontSize,
    },
    [
      h(
        "div",
        {
          display: "flex",
          alignItems: "center",
          height: bar,
          padding: `0 ${pad}px`,
          background: c.bar,
          borderBottom: `1px solid ${c.border}`,
          position: "relative",
        },
        [
          h(
            "div",
            { display: "flex", gap: dot * 0.65 },
            [0, 1, 2].map(() =>
              h("div", { width: dot, height: dot, borderRadius: 999, background: c.dot }),
            ),
          ),
          h(
            "div",
            {
              position: "absolute",
              left: 0,
              top: 0,
              width: width - 2,
              height: bar - 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: c.muted,
              fontSize: wide ? 15 : 12,
            },
            "docsxai run",
          ),
        ],
      ),
      h("div", { display: "flex", flexDirection: "column", padding: pad }, rows.map(row)),
    ],
  );
  return { size: { width, height }, tree };
}

/** The `docsxai run` units of `workspace`, in the order a run at concurrency 1 takes them. */
async function runUnits(workspace) {
  const { parseFlowFile } = await engine("flow-file.js");
  const { expandFlow } = await engine("flow-matrix.js");
  const dir = join(workspace, "flows");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".flow.yaml")).sort();
  if (files.length === 0) throw new Error(`no flow files in ${dir}`);
  const units = [];
  for (const f of files) {
    const flow = parseFlowFile(await readFile(join(dir, f), "utf8"), f);
    for (const v of expandFlow(flow)) {
      const at = join(workspace, "docs", flow.name, ...(v.id ? [v.id] : []), "annotations.json");
      const doc = JSON.parse(await readFile(at, "utf8"));
      units.push({
        flow: flow.name,
        variant: v.id,
        steps: v.flow.steps.length,
        annotations: doc.annotations.length,
      });
    }
  }
  return units;
}

async function main() {
  const { values } = parseArgs({
    options: {
      raw: { type: "string" },
      out: { type: "string" },
      screen: { type: "string", default: "progress" },
      workspace: { type: "string" },
    },
  });
  if (!values.raw || !values.out)
    throw new Error("usage: --raw <dir> --out <dir> (see the header)");
  if (spawnSync("cwebp", ["-version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("needs `cwebp` on PATH (`brew install webp` or `apt install webp`)");
  }
  const raw = resolve(values.raw);
  const out = resolve(values.out);
  const workspace = resolve(values.workspace ?? join(raw, "workspace"));
  const satoriModule = await load(fromViewer, "satori");
  // require.resolve finds the CommonJS build, whose namespace nests the function one level down.
  const satori = satoriModule.default?.default ?? satoriModule.default;
  const { Resvg } = await load(fromViewer, "@resvg/resvg-js");
  const { default: sharp } = await load(fromWebsite, "sharp");
  const fontList = await fonts();
  const units = await runUnits(workspace);
  const command = `docsxai run ${basename(workspace)}`;
  const lines = {
    1280: runTranscript(basename(workspace), units),
    390: compactTranscript(basename(workspace), units),
  };

  const tmp = await mkdtemp(join(tmpdir(), "landing-showcase-"));
  const written = [];
  const manifest = { schema: "docsxai/landing-showcase@1", shots: {} };
  try {
    const burnedOut = join(tmp, "burned");
    for (const theme of THEMES) burnScreen(raw, burnedOut, values.screen, theme);
    const pack = JSON.parse(await readFile(join(burnedOut, "manifest.json"), "utf8"));
    await mkdir(out, { recursive: true });

    const draw = async (shot, theme, width, { size, tree }) => {
      const density = DENSITY[width];
      const svg = await satori(tree, { ...size, fonts: fontList });
      const rendered = new Resvg(svg, {
        font: { loadSystemFonts: false },
        fitTo: { mode: "width", value: size.width * density },
      })
        .render()
        .asPng();
      const png = await sharp(rendered)
        .png({ palette: true, colors: 256, dither: 0.6, effort: 10, compressionLevel: 9 })
        .toBuffer();
      const hash = contentHash(png);
      const pngName = assetName(shot, theme, width, hash, "png", density);
      const webpName = assetName(shot, theme, width, hash, "webp", density);
      await writeFile(join(out, pngName), png);
      await promisify(execFile)("cwebp", cwebpArgs(join(out, pngName), join(out, webpName)));
      const webp = await readFile(join(out, webpName));
      for (const [name, bytes] of [
        [pngName, png.length],
        [webpName, webp.length],
      ]) {
        if (bytes >= MAX_BYTES)
          throw new Error(`${name} is ${bytes} bytes, the limit is ${MAX_BYTES}`);
      }
      if (webp.length >= png.length) {
        throw new Error(
          `${webpName} (${webp.length} B) is not smaller than ${pngName} (${png.length} B)`,
        );
      }
      written.push(pngName, webpName);
      const files = (manifest.shots[shot] ??= {});
      const entry = (files[theme] ??= {});
      const pixels = { pixelWidth: size.width * density, pixelHeight: size.height * density };
      entry[`${width}.png`] = { name: pngName, ...size, density, ...pixels, bytes: png.length };
      entry[`${width}.webp`] = { name: webpName, ...size, density, ...pixels, bytes: webp.length };
    };

    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const variant = `en.${theme}.${width}`;
        const v = pack.screens?.[values.screen]?.variants?.[variant];
        if (!v) throw new Error(`burn-trackxai wrote no ${values.screen} ${variant}`);
        const rawPng = await readFile(join(raw, `${values.screen}.${variant}.png`));
        const burned = await readFile(join(burnedOut, v.src.slice("/screens/".length)));
        const rawSize = { width: rawPng.readUInt32BE(16), height: rawPng.readUInt32BE(20) };
        await draw(
          "pipeline",
          theme,
          width,
          pipelineTree({ width, theme, raw: rawPng, burned, rawSize }),
        );
        await draw(
          "terminal",
          theme,
          width,
          terminalTree({ width, theme, command, lines: lines[width] }),
        );
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  for (const shot of Object.keys(manifest.shots)) {
    for (const theme of THEMES) {
      const files = manifest.shots[shot][theme];
      manifest.shots[shot][theme] = { files, picture: pictureFor(files, "/showcase") };
    }
  }
  for (const old of staleFiles(await readdir(out), written)) {
    await rm(join(out, old), { force: true });
    console.error(`removed ${join(out, old)}`);
  }
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of written) console.log(join(out, f));
  console.log(join(out, "manifest.json"));
}

main().catch((e) => {
  console.error(`landing-showcase: ${e.message}`);
  process.exit(1);
});
