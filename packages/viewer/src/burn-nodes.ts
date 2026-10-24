// The Satori nodes of one burned callout and its badge, in screenshot px. Split from burn.ts,
// which lays annotations out and runs the render.

import type { Rect } from "./placement.js";
import { badgeRadius, connectorColor, type BurnTheme } from "./burn-theme.js";
import { connectorNodes } from "./burn-connector.js";
import { lineNodes, type DrawnStyle } from "./burn-line.js";
import { CONNECTOR_HALO, type PixelGrid } from "./connector-contrast.js";
import { BADGE_BORDER, BADGE_FONT_SIZE } from "./burn-badge.js";
import { layoutBoxes, type CalloutLayout, type CalloutStyle } from "./burn-callout.js";
import type { BurnNode } from "./burn.js";

export function div(
  style: Record<string, string | number>,
  children?: BurnNode[] | string,
): BurnNode {
  return { type: "div", props: { style, ...(children !== undefined ? { children } : {}) } };
}

/** Weight the callout text is drawn in: the theme's, when its own font file can supply it. */
export const effectiveWeight = (theme: BurnTheme): number =>
  theme.fontFile !== null ? theme.fontWeight : 400;

/**
 * What sizes a callout box under `theme`. A burn given a theme balances its lines; one without
 * keeps the greedy wrap it always had, so its bytes do not move.
 */
export const calloutStyleOf = (theme: BurnTheme, themed: boolean): CalloutStyle => ({
  fontSize: theme.fontSize,
  lineHeight: theme.lineHeight,
  paddingX: theme.paddingX,
  paddingY: theme.paddingY,
  borderWidth: theme.calloutBorderWidth,
  ...(themed ? { wrap: "balance" as const } : {}),
});

export interface DrawnCallout {
  nodes: BurnNode[];
  /** Boxes the callout, arrow and stem occupy (nudge applied), for later annotations to avoid. */
  boxes: Rect[];
}

/**
 * `layout` and `theme` are in screenshot px, already multiplied by the caption scale `f`. With
 * `themed`, a connector lost on the pixels under it takes the callout's fill (see burn-connector.ts).
 */
export function calloutNodes(
  layout: CalloutLayout,
  theme: BurnTheme,
  f: number,
  themed: boolean,
  connector: DrawnStyle,
  pixels?: PixelGrid,
): DrawnCallout {
  const { lines, size: callout, nudge } = layout;
  const nodes: BurnNode[] =
    connector === "arrow"
      ? connectorNodes(
          layout,
          pixels,
          connectorColor(theme),
          CONNECTOR_HALO * f,
          themed ? theme.calloutBackground : undefined,
        )
      : lineNodes(layout, theme, f, connector, pixels);
  nodes.push(
    div(
      {
        position: "absolute",
        left: layout.callout.x + nudge.x,
        top: layout.callout.y + nudge.y,
        width: callout.width,
        height: callout.height,
        display: "flex",
        flexDirection: "column",
        paddingTop: theme.paddingY,
        paddingBottom: theme.paddingY,
        paddingLeft: layout.paddingX ?? theme.paddingX,
        paddingRight: layout.paddingX ?? theme.paddingX,
        backgroundColor: theme.calloutBackground,
        border: `${theme.calloutBorderWidth}px solid ${theme.calloutBorderColor}`,
        borderRadius: theme.radius,
        color: theme.ink,
        fontSize: theme.fontSize,
        ...(effectiveWeight(theme) !== 400 ? { fontWeight: effectiveWeight(theme) } : {}),
        ...(theme.shadow !== null ? { boxShadow: theme.shadow } : {}),
      },
      lines.map((line) =>
        div(
          { height: theme.lineHeight, lineHeight: `${theme.lineHeight}px`, whiteSpace: "nowrap" },
          line,
        ),
      ),
    ),
  );
  return { nodes, boxes: layoutBoxes(layout) };
}

export function badgeNode(box: Rect, index: number, theme: BurnTheme, f: number): BurnNode {
  return div(
    {
      position: "absolute",
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.badgeFill,
      border: `${BADGE_BORDER * f}px solid #fff`,
      borderRadius: badgeRadius(theme.badgeShape, box.height),
      color: "#fff",
      fontSize: BADGE_FONT_SIZE * f,
    },
    String(index),
  );
}
