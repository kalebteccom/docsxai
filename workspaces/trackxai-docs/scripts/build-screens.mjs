#!/usr/bin/env node
// Packs burned screenshots into the delivery shape: hashed PNGs + manifest.json.
// Usage: node scripts/build-screens.mjs <out-dir>   (run after `docsxai run` + `docsxai-viewer burn`)
// Writes <out>/<flow>/<step>.<hash8>.png and <out>/manifest.json (docsxai/screens-pack@1).
// Variants are named <language>.<scheme>.<width>; add a flow to VARIANTS to pack it.
// Each page carries one English `alt` from alt.json, shared by its variants. A page with no entry,
// an entry for no page, or any loopback address in an alt or a callout stops the pack.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ws = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(ws, ".screens"));
const VARIANTS = { "desktop-1280": "en.dark.1280", "mobile-390": "en.dark.390" };
const LOOPBACK = /127\.0\.0\.1|localhost/i;
const alts = JSON.parse(readFileSync(join(ws, "alt.json"), "utf8"));
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
    const alt = alts[step];
    if (typeof alt !== "string" || alt.trim() === "") {
      throw new Error(`build-screens: alt.json has no alt for page "${step}"`);
    }
    (screens[step] ??= { alt, variants: {} }).variants[variant] = {
      src: `/screens/${rel}`,
      width,
      height,
      bytes: bytes.length,
      callouts: annotations.annotations.filter((a) => a.step === step).map((a) => a.copy),
    };
  }
}
for (const page of Object.keys(alts)) {
  if (!(page in screens)) throw new Error(`build-screens: alt.json names unknown page "${page}"`);
}
const leaks = [];
for (const [page, screen] of Object.entries(screens)) {
  if (LOOPBACK.test(screen.alt)) leaks.push(`${page} alt`);
  for (const [variant, v] of Object.entries(screen.variants)) {
    v.callouts.forEach(
      (c, i) => LOOPBACK.test(c) && leaks.push(`${page} ${variant} callout ${i + 1}`),
    );
  }
}
if (leaks.length > 0) throw new Error(`build-screens: loopback address in ${leaks.join(", ")}`);
const manifest = { schema: "docsxai/screens-pack@1", screens };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(`wrote ${Object.keys(screens).length} screens to ${out}\n`);
