// Generates the social-share card at public/og.png (1200x630).
// Hand-built SVG rasterized with sharp. Re-run after a brand change:
//   node scripts/gen-og.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og.png");

const amber = "#C8901C";
const gold = "#FFCD78";
const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g1" cx="0.13" cy="0" r="0.75">
      <stop offset="0" stop-color="${amber}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${amber}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="0.9" cy="0.04" r="0.6">
      <stop offset="0" stop-color="${gold}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${gold}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#140D04"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  ${Array.from({ length: 13 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="630" stroke="${amber}" stroke-opacity="0.05"/>`).join("")}
  ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="1200" y2="${i * 100}" stroke="${amber}" stroke-opacity="0.05"/>`).join("")}

  <!-- docsxai mark (white): tight automation loop plus writing strokes.
       Glyph paths mirror brand/docsxai-mark-white.svg. -->
  <g transform="translate(82,54) scale(1.15)" stroke="#FAFAF7" fill="none" stroke-linecap="butt">
    <path d="M74.1 55A27 27 0 1 1 67.1 28.9" stroke-width="9"/>
    <path d="M36 41H84" stroke-width="6.5"/>
    <path d="M36 53H58" stroke-width="6.5"/>
  </g>

  <text x="86" y="300" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="150" letter-spacing="-6" fill="#fdf6e9">doc<tspan fill="${amber}">s</tspan><tspan fill="#fdf6e9">x</tspan>ai</text>

  <text x="90" y="372" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="40" fill="#d2bd9b">Write a flow once. Replay it forever.</text>

  <text x="90" y="170" font-family="Courier New, monospace" font-weight="700" font-size="24" letter-spacing="6" fill="${amber}">DETERMINISTIC SCREENSHOT DOCS</text>

  <text x="90" y="560" font-family="Courier New, monospace" font-size="26" fill="#8a7556">docsxai.dev</text>
  <text x="600" y="560" text-anchor="middle" font-family="Courier New, monospace" font-size="26" fill="#8a7556">Apache-2.0 licensed</text>
  <text x="1110" y="560" text-anchor="end" font-family="Courier New, monospace" font-size="26" fill="#8a7556">Kalebtec</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote", out);
