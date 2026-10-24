// Contrast check for the Starlight site's accent. Pure; no IO. The emitter calls it with the
// accent in effect and appends the lines to its warnings. A failing accent only warns: the emitted
// colours never change.
//
// Starlight draws link text, our focus ring and our buttons in `--sl-color-text-accent`, which is
// the accent itself on the light theme and the derived `accent-high` (accent mixed 70% towards
// white, at least 8:1 on the dark background for any accent) on the dark theme. The raw accent
// also draws borders and outlines on both themes (search focus, table of contents, badges). So the
// raw accent is held to 4.5:1 for text on light, and to 3:1 for UI on light and on dark. No colour
// reaches 4.5:1 on both backgrounds, so raw-accent text on dark is not checked.

import { contrastRatio } from "./color.js";

/** Starlight's default page backgrounds (`--sl-color-bg` in `style/props.css`, 0.41). */
export const STARLIGHT_LIGHT_BG = "#ffffff"; // hsl(0, 0%, 100%)
export const STARLIGHT_DARK_BG = "#17181c"; // hsl(224, 10%, 10%)

/** WCAG AA minimums: normal text, and UI components such as a focus ring or a button edge. */
const TEXT_MIN = 4.5;
const UI_MIN = 3;

const UI_USE = `${String(UI_MIN)}:1 for the focus ring and buttons`;

/** The ratio cut to one decimal, so a failing 4.46 never prints as the passing 4.5. */
function shown(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}

/** One line per Starlight background the `#rrggbb` accent falls under WCAG AA on; empty when it passes. */
export function accentContrastWarnings(accent: string): string[] {
  const out: string[] = [];
  const line = (bg: string, name: string, needs: string) =>
    out.push(
      `accent ${accent} on ${name} background is ${shown(contrastRatio(accent, bg))}:1, WCAG AA needs ${needs}`,
    );
  const light = contrastRatio(accent, STARLIGHT_LIGHT_BG);
  if (light < UI_MIN)
    line(STARLIGHT_LIGHT_BG, "light", `${String(TEXT_MIN)}:1 for link text and ${UI_USE}`);
  else if (light < TEXT_MIN)
    line(STARLIGHT_LIGHT_BG, "light", `${String(TEXT_MIN)}:1 for link text`);
  if (contrastRatio(accent, STARLIGHT_DARK_BG) < UI_MIN) line(STARLIGHT_DARK_BG, "dark", UI_USE);
  return out;
}
