// The caption theme as CSS variables for the interactive viewer. VIEWER_STYLE reads each of them
// with today's value as the fallback, so a page built without a theme is unchanged and a page
// built with one shows the halo, badge, callout and arrow the burner draws.
//
// Every value is a checked hex colour, a number of px or a canonical shadow, so none of it can
// carry markup or a rule of its own into the page's inline stylesheet.

import { badgeRadius, connectorColor, haloRadius, type BurnTheme } from "./burn-theme.js";
import { rgbaOf } from "./color.js";

/** Family name the embedded theme font is registered under. */
export const THEME_FONT_FAMILY = "docsxai-caption";
const OTTO = 0x4f54544f;

export interface ThemeStyle {
  /** Rules to append after VIEWER_STYLE. */
  css: string;
  /** The css holds a data: font, so the page's CSP must allow `font-src data:`. */
  embedsFont: boolean;
}

function fontFace(font: Buffer): string {
  const cff = font.readUInt32BE(0) === OTTO;
  const mime = cff ? "font/otf" : "font/ttf";
  const format = cff ? "opentype" : "truetype";
  return `@font-face { font-family: "${THEME_FONT_FAMILY}"; src: url(data:${mime};base64,${font.toString("base64")}) format("${format}"); }`;
}

/** `--sd-*` variables of `theme`, one rule on `:root`. */
export function themeVariables(theme: BurnTheme): string {
  const border = `${theme.calloutBorderWidth}px solid ${theme.calloutBorderColor}`;
  const vars: Array<[string, string]> = [
    ["accent", theme.accent],
    ["accent-glow", rgbaOf(theme.accent, 0.35)],
    ["accent-pulse", rgbaOf(theme.accent, 0.3)],
    ["halo-radius", `${haloRadius(theme)}px`],
    ["badge-fill", theme.badgeFill],
    ["badge-radius", `${badgeRadius(theme.badgeShape, 22)}px`],
    ["callout-bg", theme.calloutBackground],
    ["callout-ink", theme.ink],
    ["callout-border", border],
    ["callout-radius", `${theme.radius}px`],
    ["callout-shadow", theme.shadow ?? "none"],
    ["callout-padding", `${theme.paddingY}px ${theme.paddingX}px`],
    ["callout-font-size", `${theme.fontSize}px`],
    ["callout-line-height", `${theme.lineHeight}px`],
    ["connector", connectorColor(theme)],
  ];
  return `:root { ${vars.map(([k, v]) => `--sd-${k}: ${v};`).join(" ")} }`;
}

/** The style a themed page appends. `font` is the theme's font file when it has one. */
export function themeStyle(theme: BurnTheme, font?: Buffer): ThemeStyle {
  const rules = [themeVariables(theme)];
  if (font) {
    rules.push(
      fontFace(font),
      `:root { --sd-font: "${THEME_FONT_FAMILY}", system-ui, sans-serif; }`,
    );
  }
  return { css: `\n  ${rules.join("\n  ")}\n`, embedsFont: font !== undefined };
}
