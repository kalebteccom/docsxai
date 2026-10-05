#!/usr/bin/env node
// Packs burned screenshots into the delivery shape: hashed PNGs + manifest.json.
// Usage: node scripts/build-screens.mjs <out-dir>   (run after `docsxai run` + `docsxai-viewer burn`)
// Writes <out>/<flow>/<step>.<hash8>.png and <out>/manifest.json (docsxai/screens-pack@1).
// Variants are named <language>.<scheme>.<width>; add a flow to VARIANTS to pack it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ws = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(ws, ".screens"));
const VARIANTS = { "desktop-1280": "en.dark.1280", "mobile-390": "en.dark.390" };
const screens = {};
for (const [flow, variant] of Object.entries(VARIANTS)) {
  // Drop images from earlier packs so the folder holds exactly what the manifest lists.
  rmSync(join(out, flow), { recursive: true, force: true });
  const dir = join(ws, "docs", flow, "burned");
  const annotations = JSON.parse(readFileSync(join(ws, "docs", flow, "annotations.json"), "utf8"));
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()) {
    const step = file.slice(0, -4);
    const bytes = readFileSync(join(dir, file));
    const hash8 = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const rel = `${flow}/${step}.${hash8}.png`;
    mkdirSync(join(out, flow), { recursive: true });
    writeFileSync(join(out, rel), bytes);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    (screens[step] ??= { variants: {} }).variants[variant] = {
      src: `/screens/${rel}`,
      width,
      height,
      bytes: bytes.length,
      callouts: annotations.annotations.filter((a) => a.step === step).map((a) => a.copy),
    };
  }
}
const manifest = { schema: "docsxai/screens-pack@1", screens };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(`wrote ${Object.keys(screens).length} screens to ${out}\n`);
