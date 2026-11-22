// Generates the social-share card at public/og.png (1200x630).
// Hand-built SVG rasterized with sharp. Re-run after a brand change:
//   node scripts/gen-og.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og.png");

const amber = "#C8901C";
const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#140D04"/>

  <!-- docsxai mark (white): tight automation loop plus writing strokes.
       Glyph paths mirror brand/docsxai-mark-white.svg. -->
  <g transform="translate(82,54) scale(1.15)" stroke="#FAFAF7" fill="none" stroke-linecap="butt">
    <path d="M74.1 55A27 27 0 1 1 67.1 28.9" stroke-width="9"/>
    <path d="M36 41H84" stroke-width="6.5"/>
    <path d="M36 53H58" stroke-width="6.5"/>
  </g>

  <text x="86" y="300" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="150" letter-spacing="-6" fill="#fdf6e9">doc<tspan fill="${amber}">s</tspan><tspan fill="#fdf6e9">x</tspan>ai</text>

  <text x="90" y="372" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="40" fill="#d2bd9b">Screenshot docs that never go stale.</text>

  <text x="90" y="560" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a7556">docsxai.dev</text>
  <text x="600" y="560" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a7556">Apache-2.0 licensed</text>
  <text x="1110" y="560" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a7556">Kalebtec</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
