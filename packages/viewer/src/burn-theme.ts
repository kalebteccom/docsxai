// The look of a burned caption (halo, numbered badge, callout, arrow) and of the live viewer's
// overlay. One resolved `BurnTheme` drives both, so a screenshot burned for a wiki and the same
// screenshot in the interactive viewer match.
//
// The default theme is today's look, value for value: burning without a theme gives the same
// bytes as before themes existed. Three presets sit beside it. `burn-theme-config.ts` validates
// the `burn.theme` block of `.docsxai.json` and layers default < preset < tokens file < inline
// keys on top of these values.

import { contrastRatio } from "./color.js";
import { BADGE_FILL } from "./viewer-style.js";

export const BADGE_SHAPES = ["circle", "rounded", "square"] as const;
export type BadgeShape = (typeof BADGE_SHAPES)[number];

export const THEME_PRESET_NAMES = ["clean", "soft", "high-contrast"] as const;
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
}

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
};

export type ThemeLayer = Partial<BurnTheme>;

/** Every preset sets every field except `fontFile`, so a preset never inherits the default look. */
export const THEME_PRESETS: Record<ThemePresetName, Required<Omit<BurnTheme, "fontFile">>> = {
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
  },
};

/** Halo corner radius for a callout radius; `7 -> 4` keeps the default look. */
export const haloRadius = (theme: BurnTheme): number => Math.round((theme.radius * 4) / 7);

/** Colour of the arrow and stem: the callout outline, or the text colour when there is none. */
export const connectorColor = (theme: BurnTheme): string =>
  theme.calloutBorderWidth > 0 ? theme.calloutBorderColor : theme.ink;

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

/** One line per text pair under WCAG AA; empty when every pair passes. */
export function contrastWarnings(theme: BurnTheme): string[] {
  return themeContrast(theme)
    .filter((c) => !c.ok)
    .map(
      (c) =>
        `burn.theme: ${c.pair} is ${c.ratio.toFixed(2)}:1, WCAG AA needs ${c.min}:1; the captions are harder to read than they should be`,
    );
}
