// The stem and arrow joining a burned callout to its target. Ink on the page as ever; on dark
// pixels (see connector-contrast.ts) a white outline goes under both so they stay visible.

import { arrowGeometry, arrowHaloGeometry, growRect } from "./arrow.js";
import { CONNECTOR_HALO, needsConnectorHalo, type PixelGrid } from "./connector-contrast.js";
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
 * light background, the nodes are exactly the plain ink ones.
 */
export function connectorNodes(layout: CalloutLayout, pixels?: PixelGrid): BurnNode[] {
  const { nudge, stem } = layout;
  const arrow = layout.side && layout.arrow ? arrowGeometry(layout.side, layout.arrow) : null;
  if (!stem && !arrow) return [];
  const halo =
    pixels !== undefined &&
    needsConnectorHalo(
      pixels,
      layoutBoxes(layout)
        .slice(1)
        .map((b) => growRect(b, CONNECTOR_HALO)),
    );
  const nodes: BurnNode[] = [];
  if (halo) {
    if (stem) {
      const s = growRect(stem, CONNECTOR_HALO);
      nodes.push(box(s.x + nudge.x, s.y + nudge.y, s.width, s.height, CONNECTOR_HALO_COLOR));
    }
    if (layout.side && layout.arrow) {
      const h = arrowHaloGeometry(layout.side, layout.arrow, CONNECTOR_HALO);
      nodes.push(
        box(h.left + nudge.x, h.top + nudge.y, h.width, h.height, CONNECTOR_HALO_COLOR, h.clipPath),
      );
    }
  }
  if (stem) {
    nodes.push(box(stem.x + nudge.x, stem.y + nudge.y, stem.width, stem.height, CONNECTOR_INK));
  }
  if (arrow) {
    nodes.push(
      box(
        arrow.left + nudge.x,
        arrow.top + nudge.y,
        arrow.width,
        arrow.height,
        CONNECTOR_INK,
        arrow.clipPath,
      ),
    );
  }
  return nodes;
}
