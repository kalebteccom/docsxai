// The stem and arrow joining a burned callout to its target. Ink on the page as ever; on dark
// pixels (see connector-contrast.ts) a white outline goes under both so they stay visible.

import { arrowGeometry, arrowHaloGeometry, growRect } from "./arrow.js";
import {
  CONNECTOR_HALO,
  needsConnectorHalo,
  toneOf,
  type PixelGrid,
} from "./connector-contrast.js";
import { layoutBoxes, type CalloutLayout } from "./burn-callout.js";
import type { BurnNode } from "./burn.js";

export const CONNECTOR_INK = "#1c1c1c";
export const CONNECTOR_HALO_COLOR = "#ffffff";

function box(
  left: number,
  top: number,
  width: number,
  height: number,
  color: string,
  clipPath?: string,
): BurnNode {
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left,
        top,
        width,
        height,
        backgroundColor: color,
        ...(clipPath ? { clipPath } : {}),
      },
    },
  };
}

/**
 * Stem and arrow nodes for a laid-out callout, nudge applied. With `pixels`, a connector whose
 * background is dark gets its outline nodes first (below both inks). Without `pixels`, or on a
 * light background, the nodes are exactly the plain ink ones. `ink` is the connector colour; a
 * light one is outlined in dark ink on light pixels, the mirror of the default. `haloMargin` is
 * the outline's width in px.
 */
export function connectorNodes(
  layout: CalloutLayout,
  pixels?: PixelGrid,
  ink: string = CONNECTOR_INK,
  haloMargin: number = CONNECTOR_HALO,
): BurnNode[] {
  const tone = toneOf(ink);
  const haloColor = tone === "dark" ? CONNECTOR_HALO_COLOR : CONNECTOR_INK;
  const { nudge, stem } = layout;
  const arrow =
    layout.side && layout.arrow
      ? arrowGeometry(layout.side, layout.arrow, layout.arrowLength)
      : null;
  if (!stem && !arrow) return [];
  const halo =
    pixels !== undefined &&
    needsConnectorHalo(
      pixels,
      layoutBoxes(layout)
        .slice(1)
        .map((b) => growRect(b, haloMargin)),
      tone,
    );
  const nodes: BurnNode[] = [];
  if (halo) {
    if (stem) {
      const s = growRect(stem, haloMargin);
      nodes.push(box(s.x + nudge.x, s.y + nudge.y, s.width, s.height, haloColor));
    }
    if (layout.side && layout.arrow) {
      const h = arrowHaloGeometry(layout.side, layout.arrow, haloMargin, layout.arrowLength);
      nodes.push(box(h.left + nudge.x, h.top + nudge.y, h.width, h.height, haloColor, h.clipPath));
    }
  }
  if (stem) {
    nodes.push(box(stem.x + nudge.x, stem.y + nudge.y, stem.width, stem.height, ink));
  }
  if (arrow) {
    nodes.push(
      box(
        arrow.left + nudge.x,
        arrow.top + nudge.y,
        arrow.width,
        arrow.height,
        ink,
        arrow.clipPath,
      ),
    );
  }
  return nodes;
}
