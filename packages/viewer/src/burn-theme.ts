// The look of a burned caption (halo, numbered badge, callout, arrow) and of the live viewer's
// overlay. One resolved `BurnTheme` drives both, so a screenshot burned for a wiki and the same
// screenshot in the interactive viewer match.
//
// The default theme is today's look, value for value: burning without a theme gives the same
// bytes as before themes existed. Four presets sit beside it. `burn-theme-config.ts` validates
// the `burn.theme` block of `.docsxai.json` and layers default < preset < tokens file < inline
// keys on top of these values.

import { contrastRatio } from "./color.js";
import { BADGE_FILL } from "./viewer-style.js";

export const BADGE_SHAPES = ["circle", "rounded", "square"] as const;
export type BadgeShape = (typeof BADGE_SHAPES)[number];

/**
 * How a callout is joined to its target. `arrow` is the filled triangle (and stem) docsxai always
 * drew. `line` is a thin line from the caption edge ending in a small dot on the target, `chevron`
 * the same line ending in a small open chevron. `auto` is `arrow` for a burn without a theme and
 * `line` for a themed one.
 */
export const CONNECTOR_STYLES = ["auto", "arrow", "line", "chevron"] as const;
export type ConnectorStyle = (typeof CONNECTOR_STYLES)[number];

/**
 * What a clean burn (line connector) draws for an annotation: `full` the caption, `badge` only the
 * numbered badge and the ring (the page lists the callout text), `auto` the caption when a spot
 * clear of text exists, else the badge. The triangle connector always draws the caption.
 */
export const CAPTION_STYLES = ["full", "badge", "auto"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const THEME_PRESET_NAMES = ["clean", "soft", "high-contrast", "readable"] as const;
export type ThemePresetName = (typeof THEME_PRESET_NAMES)[number];

export interface BurnTheme {
  /** Halo outline; its glow is the same colour at 35% opacity. */
  accent: string;
  /** Callout text. */
  ink: string;
  calloutBackground: string;
  /** Callout outline, and the arrow and stem that join it to the target. */
  calloutBorderColor: string;
  /** Px; 0 draws no outline. */
  calloutBorderWidth: number;
  /** Callout corner radius in px. The halo's is 4/7 of it. */
  radius: number;
  /** Canonical CSS `box-shadow` of the callout (`<x>px <y>px <blur>px <spread>px <colour>`, comma separated); null for none. */
  shadow: string | null;
  badgeShape: BadgeShape;
  /** Badge fill; its digits and outline are white. */
  badgeFill: string;
  /** Callout text size and line pitch in px. */
  fontSize: number;
  lineHeight: number;
  /** Callout padding in px. */
  paddingX: number;
  paddingY: number;
  /** Absolute path of a TTF or OTF the callout text uses; null selects the bundled Inter. */
  fontFile: string | null;
  /**
   * Absolute paths of TTF or OTF files tried, in order, for characters `fontFile` (or the bundled
   * Inter) lacks, before the bundled Noto Sans Arabic, Hebrew, Thai and Devanagari. Absent: none.
   */
  fontFallback?: string[];
  /**
   * Weight the callout text is set in, 400 or 600. The weight comes from the font file: the
   * bundled Inter ships regular only, so 600 needs a semibold `fontFile`.
   */
  fontWeight: FontWeight;
  /** How the callout is joined to its target, see {@link CONNECTOR_STYLES}. */
  connectorStyle: ConnectorStyle;
  /** Caption or badge only, see {@link CAPTION_STYLES}. */
  captionStyle: CaptionStyle;
  /** Length of the arrow in px (its base is 7/4 of that wide). The callout keeps 2 px more than that from its target. */
  arrowSize: number;
  /**
   * Widest callout as a share of the screenshot's width. Below 0.62 it limits every callout; at
   * 0.62 or more it limits only callouts planned around obstacles.
   */
  maxWidthRatio: number;
  /**
   * Multiplier of every caption dimension (text, padding, outline, radius, arrow, badge, halo,
   * shadow), or `"auto"`: the screenshot's width over `displayWidth`, at least the pixel ratio and
   * at most {@link AUTO_SCALE_MAX} times it, so a screenshot the page shrinks to its column reads
   * at base size. On the page, text is `fontSize * scale * (displayWidth / imageWidth)` CSS px.
   * null, the default, is the pixel ratio: a 2x capture's caption has the 1x capture's CSS size.
   * A number is used as written, whatever the pixel ratio.
   */
  scale: number | "auto" | null;
  /** CSS px the screenshot is shown at on the page. Read by `scale: "auto"`. */
  displayWidth: number;
  /**
   * CSS px a screenshot narrower than `narrowBelow` is shown at (a phone capture in a narrow
   * column). null uses `displayWidth` for every screenshot.
   */
  displayWidthNarrow: number | null;
  /** Screenshot width in px under which `displayWidthNarrow` applies; null means {@link NARROW_BELOW_DEFAULT}. */
  narrowBelow: number | null;
}

/** Weight the callout text is drawn in: the theme's, when its own font file can supply it. */
export const effectiveWeight = (theme: BurnTheme): FontWeight =>
  theme.fontFile !== null ? theme.fontWeight : 400;

/** Screenshot width in px under which `displayWidthNarrow` applies when the config names no threshold. */
export const NARROW_BELOW_DEFAULT = 900;

export const FONT_WEIGHTS = [400, 600] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

/**
 * Largest factor `scale: "auto"` picks at a pixel ratio of 1 (it is multiplied by the ratio). 4 is
 * the top of the explicit `scale` range, and it keeps a 1440 px screenshot shown at 360 px (factor
 * 4) at its base text size.
 */
export const AUTO_SCALE_MAX = 4;

/** Today's look. Every number and colour here is what `burn.ts` hard-coded before themes. */
export const DEFAULT_BURN_THEME: BurnTheme = {
  accent: "#e8590c",
  ink: "#1c1c1c",
  calloutBackground: "#fff",
  calloutBorderColor: "#1c1c1c",
  calloutBorderWidth: 1,
  radius: 7,
  shadow: null,
  badgeShape: "circle",
  badgeFill: BADGE_FILL,
  fontSize: 14,
  lineHeight: 19,
  paddingX: 11,
  paddingY: 8,
  fontFile: null,
  fontWeight: 400,
  connectorStyle: "auto",
  captionStyle: "auto",
  arrowSize: 8,
  maxWidthRatio: 0.62,
  scale: null,
  displayWidth: 720,
  displayWidthNarrow: null,
  narrowBelow: null,
};

export type ThemeLayer = Partial<BurnTheme>;

/** What a preset sets besides its own look: the caption stays at base size and the bundled font's weight. */
const PLAIN_SIZING = {
  fontWeight: 400,
  connectorStyle: "auto",
  captionStyle: "auto",
  arrowSize: 8,
  maxWidthRatio: 0.62,
  scale: null,
  displayWidth: 720,
  displayWidthNarrow: null,
  narrowBelow: null,
} as const;

/** Every preset sets every field except `fontFile` and `fontFallback`, so a preset never inherits the default look. */
export const THEME_PRESETS: Record<
  ThemePresetName,
  Required<Omit<BurnTheme, "fontFile" | "fontFallback">>
> = {
  clean: {
    accent: "#2563eb",
    ink: "#111827",
    calloutBackground: "#ffffff",
    calloutBorderColor: "#1f2937",
    calloutBorderWidth: 1,
    radius: 6,
    shadow: "0px 2px 8px 0px rgba(17,24,39,0.18)",
    badgeShape: "rounded",
    badgeFill: "#1d4ed8",
    fontSize: 14,
    lineHeight: 20,
    paddingX: 12,
    paddingY: 8,
    ...PLAIN_SIZING,
  },
  soft: {
    accent: "#7c3aed",
    ink: "#2e1065",
    calloutBackground: "#faf5ff",
    calloutBorderColor: "#6d28d9",
    calloutBorderWidth: 1,
    radius: 12,
    shadow: "0px 6px 18px 0px rgba(76,29,149,0.22)",
    badgeShape: "circle",
    badgeFill: "#6d28d9",
    fontSize: 14,
    lineHeight: 20,
    paddingX: 14,
    paddingY: 10,
    ...PLAIN_SIZING,
  },
  "high-contrast": {
    accent: "#d10000",
    ink: "#000000",
    calloutBackground: "#ffffff",
    calloutBorderColor: "#000000",
    calloutBorderWidth: 2,
    radius: 4,
    shadow: null,
    badgeShape: "square",
    badgeFill: "#000000",
    fontSize: 15,
    lineHeight: 21,
    paddingX: 12,
    paddingY: 9,
    ...PLAIN_SIZING,
  },
  // For a docs site: the caption is scaled up with the screenshot so it reads at 15 px next to
  // the page text (badge digits 12 px, halo outline 2 px, when `display_width` is the shown width). The weight stays 400 because the bundled Inter is regular only; pair the
  // preset with a semibold `font` and `font_weight: 600` for heavier text.
  readable: {
    accent: "#c2410c",
    ink: "#111827",
    calloutBackground: "#fafafa",
    calloutBorderColor: "#111827",
    calloutBorderWidth: 1,
    radius: 8,
    shadow: "0px 4px 12px 0px rgba(17,24,39,0.28)",
    badgeShape: "circle",
    badgeFill: "#9a3412",
    fontSize: 15,
    lineHeight: 21,
    paddingX: 14,
    paddingY: 10,
    ...PLAIN_SIZING,
    // Under 60% of the screenshot's width, with or without obstacles.
    maxWidthRatio: 0.55,
    scale: "auto",
  },
};

/** Halo corner radius for a callout radius; `7 -> 4` keeps the default look. */
export const haloRadius = (theme: BurnTheme): number => Math.round((theme.radius * 4) / 7);

/** Colour of the arrow and stem: the callout outline, or the text colour when there is none. */
export const connectorColor = (theme: BurnTheme): string =>
  theme.calloutBorderWidth > 0 ? theme.calloutBorderColor : theme.ink;

/** CSS px the page shows a screenshot `imageWidth` px wide at: `displayWidthNarrow` under `narrowBelow`, else `displayWidth`. */
export function displayWidthFor(theme: BurnTheme, imageWidth: number): number {
  const narrow = theme.displayWidthNarrow;
  return narrow !== null && imageWidth < (theme.narrowBelow ?? NARROW_BELOW_DEFAULT)
    ? narrow
    : theme.displayWidth;
}

/**
 * The factor `theme.scale` gives a screenshot `imageWidth` px wide taken at `pixelRatio` device px
 * per CSS px: the pixel ratio for the default, and for `auto` a screenshot at or under its display
 * width.
 */
export function captionScale(theme: BurnTheme, imageWidth: number, pixelRatio = 1): number {
  if (theme.scale === null) return pixelRatio;
  if (theme.scale !== "auto") return theme.scale;
  // The wide or narrow display width is picked by CSS width, so a 2x phone capture still counts as narrow.
  const factor = imageWidth / displayWidthFor(theme, imageWidth / pixelRatio);
  // Rounded up to 2 decimals, so on-screen sizes are never a hair under their base size.
  const rounded = Math.ceil(factor * 100 - 1e-9) / 100;
  return Math.min(AUTO_SCALE_MAX * pixelRatio, Math.max(pixelRatio, rounded));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `theme` with the dimensions the callout and halo draw multiplied by `factor`. The theme itself when `factor` is 1. */
export function scaledTheme(theme: BurnTheme, factor: number): BurnTheme {
  if (factor === 1) return theme;
  return {
    ...theme,
    calloutBorderWidth: round2(theme.calloutBorderWidth * factor),
    radius: round2(theme.radius * factor),
    shadow:
      theme.shadow === null
        ? null
        : theme.shadow.replace(
            /(-?\d+(?:\.\d+)?)px/g,
            (_, n: string) => `${round2(Number(n) * factor)}px`,
          ),
    fontSize: round2(theme.fontSize * factor),
    lineHeight: round2(theme.lineHeight * factor),
    paddingX: round2(theme.paddingX * factor),
    paddingY: round2(theme.paddingY * factor),
  };
}

/** Badge corner radius for a box of `height` px; a circle is a pill. */
export function badgeRadius(shape: BadgeShape, height: number): number {
  if (shape === "circle") return height / 2;
  return shape === "rounded" ? 6 : 0;
}

/** WCAG 2.x AA minimum for normal-size text. */
export const AA_TEXT_RATIO = 4.5;

export interface ContrastCheck {
  /** What is compared, e.g. `ink on callout_background`. */
  pair: string;
  ratio: number;
  min: number;
  ok: boolean;
}

/** The text pairs a caption shows: callout text on its background, and the badge digits on the badge fill. */
export function themeContrast(theme: BurnTheme): ContrastCheck[] {
  const check = (pair: string, fg: string, bg: string): ContrastCheck => {
    const ratio = contrastRatio(fg, bg);
    return { pair, ratio, min: AA_TEXT_RATIO, ok: ratio >= AA_TEXT_RATIO };
  };
  return [
    check("ink on callout_background", theme.ink, theme.calloutBackground),
    check("white digits on badge_fill", "#ffffff", theme.badgeFill),
  ];
}

/** What a theme asks for that the bundled font cannot give: the weight of a font file that has one weight. */
export function weightWarnings(theme: BurnTheme): string[] {
  if (theme.fontWeight === 400 || theme.fontFile !== null) return [];
  return [
    `burn.theme: font_weight ${theme.fontWeight} needs a font file with that weight; the bundled Inter is regular only, so the text stays 400. Set font to a semibold TTF or OTF`,
  ];
}

/** One line per text pair under WCAG AA; empty when every pair passes. */
export function contrastWarnings(theme: BurnTheme): string[] {
  return themeContrast(theme)
    .filter((c) => !c.ok)
    .map(
      (c) =>
        `burn.theme: ${c.pair} is ${c.ratio.toFixed(2)}:1, WCAG AA needs ${c.min}:1; the captions are harder to read than they should be`,
    );
}
