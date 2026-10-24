// Caption layout for the clean look: a caption must cover no content, halo, badge or earlier
// caption. The planner runs strict; when no spot is clear at full size it tries the text one step
// smaller (down to the floor of the screenshot's width class) before it accepts an overlap.

import {
  layoutBoxes,
  layoutCallout,
  type CalloutLayout,
  type LayoutInput,
} from "./burn-callout.js";
import { scaledTheme, type BurnTheme } from "./burn-theme.js";
import { calloutStyleOf } from "./burn-nodes.js";
import { crossingLength, overlapArea } from "./obstacle-placement.js";
import { MIN_TEXT_NARROW, SIDE_MARGIN, WIDE_FROM, shrinkSteps } from "./burn-clean.js";

/** Px² of the caption box itself on the annotation's obstacles (content and other targets). */
export function captionCover(inp: LayoutInput, l: CalloutLayout): number {
  const box = layoutBoxes(l)[0]!;
  return (inp.ann.obstacles ?? []).reduce((n, b) => n + overlapArea(box, b), 0);
}

/** Px of the connector's stem inside the annotation's obstacles; 0 for a short connector. */
export function lineCrossing(inp: LayoutInput, l: CalloutLayout): number {
  if (!l.stem) return 0;
  const stem = { ...l.stem, x: l.stem.x + l.nudge.x, y: l.stem.y + l.nudge.y };
  return crossingLength(stem, inp.ann.obstacles ?? []);
}

export interface CleanPlan {
  layout: CalloutLayout;
  /** Text size factor the caption was laid out at; 1 is the theme's size. */
  k: number;
  /** The theme the caption is drawn with, in screenshot px (caption scale times `k`). */
  theme: BurnTheme;
  /** Px² the caption still covers; 0 when a clear spot was found. */
  cover: number;
}

/**
 * The theme one text step smaller: on a phone capture also compact, with lines 2 px over the text
 * and 4 px of vertical padding, so a two-line caption fits a strip about 42 px tall.
 */
function smaller(base: BurnTheme, k: number, f: number, narrow: boolean, pr: number): BurnTheme {
  const t = scaledTheme(base, k);
  if (!narrow) return t;
  return {
    ...t,
    lineHeight: ((MIN_TEXT_NARROW + 2) * pr) / f,
    paddingY: (4 * pr) / f,
    paddingX: (8 * pr) / f,
  };
}

/** Outer width, base px, of the one-line caption tried when the usual box finds no clear spot. */
export const WIDE_CAPTION = 560;

/**
 * Lays out one caption strictly. When the usual box covers something it tries, in order, a wide
 * box (fewer lines, so it fits a thin strip), then both again with the text one step smaller, and
 * keeps the first clear layout, else the one covering least. With `lineCounts` a connector that
 * crosses content counts as covering it, so an `auto` caption with no clean line falls back.
 */
export function planClean(
  inp: LayoutInput,
  base: BurnTheme,
  f: number,
  imageWidth: number,
  lineCounts = false,
  pr = 1,
): CleanPlan {
  const narrow = imageWidth < WIDE_FROM;
  let best: { layout: CalloutLayout; k: number; cover: number } | undefined;
  // The wide box: as wide as the screenshot allows, side margins kept.
  const span = Math.min(WIDE_CAPTION, Math.floor(inp.image.width - (2 * SIDE_MARGIN * pr) / f));
  const wide = { ...inp.ann, placement: { ...inp.ann.placement, max_width: span } };
  const keepsWidth = inp.ann.placement?.max_width !== undefined;
  const themeAt = (k: number) => (k === 1 ? base : smaller(base, k, f, narrow, pr));
  for (const k of shrinkSteps(base.fontSize, f, imageWidth, pr)) {
    const style = calloutStyleOf(themeAt(k), true);
    for (const ann of keepsWidth ? [inp.ann] : [inp.ann, wide]) {
      const tried = { ...inp, ann };
      const layout = layoutCallout({
        ...tried,
        style,
        strict: true,
        ...(lineCounts ? { strictLine: true } : {}),
      });
      const cover = captionCover(tried, layout) + (lineCounts ? lineCrossing(tried, layout) : 0);
      if (best === undefined || cover < best.cover) best = { layout, k, cover };
      if (cover === 0) break;
    }
    if (best!.cover === 0) break;
  }
  const { layout, k, cover } = best!;
  return { layout, k, cover, theme: scaledTheme(themeAt(k), f) };
}
