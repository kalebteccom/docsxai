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
import { overlapArea } from "./obstacle-placement.js";
import { shrinkSteps } from "./burn-clean.js";

/** Px² of the caption box itself on the annotation's obstacles (content and other targets). */
export function captionCover(inp: LayoutInput, l: CalloutLayout): number {
  const box = layoutBoxes(l)[0]!;
  return (inp.ann.obstacles ?? []).reduce((n, b) => n + overlapArea(box, b), 0);
}

export interface CleanPlan {
  layout: CalloutLayout;
  /** Text size factor the caption was laid out at; 1 is the theme's size. */
  k: number;
  /** The theme the caption is drawn with, in screenshot px (caption scale times `k`). */
  theme: BurnTheme;
}

/** Outer width, base px, of the one-line caption tried when the usual box finds no clear spot. */
export const WIDE_CAPTION = 560;

/**
 * Lays out one caption strictly. When the usual box covers something it tries, in order, a wide
 * box (fewer lines, so it fits a thin strip), then both again with the text one step smaller, and
 * keeps the first clear layout, else the one covering least.
 */
export function planClean(
  inp: LayoutInput,
  base: BurnTheme,
  f: number,
  imageWidth: number,
): CleanPlan {
  let best: { layout: CalloutLayout; k: number; cover: number } | undefined;
  const wide = { ...inp.ann, placement: { ...inp.ann.placement, max_width: WIDE_CAPTION } };
  const keepsWidth = inp.ann.placement?.max_width !== undefined;
  for (const k of shrinkSteps(base.fontSize, f, imageWidth)) {
    const style = calloutStyleOf(k === 1 ? base : scaledTheme(base, k), true);
    for (const ann of keepsWidth ? [inp.ann] : [inp.ann, wide]) {
      const tried = { ...inp, ann };
      const layout = layoutCallout({ ...tried, style, strict: true });
      const cover = captionCover(tried, layout);
      if (best === undefined || cover < best.cover) best = { layout, k, cover };
      if (cover === 0) return { layout, k, theme: scaledTheme(base, f * k) };
    }
  }
  const { layout, k } = best!;
  return { layout, k, theme: scaledTheme(base, f * k) };
}
