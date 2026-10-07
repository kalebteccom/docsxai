// The stylesheet inlined into every interactive-viewer page (index + flow pages).
//
// Page colours come from two token sets, light and dark, switched by prefers-color-scheme. Every
// text/background pair the stylesheet uses meets WCAG AA (4.5:1); viewer-style.test.ts computes
// the ratios from these objects, so a token change that drops a pair below AA fails a test.
// The overlay (halo, badge, callout) sits on the screenshot, not on the page, so its colours are
// fixed in both schemes.

export interface ViewerTokens {
  /** Body text. */
  fg: string;
  /** Page background. */
  bg: string;
  /** Secondary text: captions, card subtitles, the footer. */
  muted: string;
  /** Panels: step write-ups, placeholders. */
  surface: string;
  /** Code inside a panel. */
  surface2: string;
  /** Decorative borders (cards, screenshot frame); not relied on to identify a control. */
  border: string;
  link: string;
  /** Focus ring on page controls. */
  focus: string;
  /** Error text. */
  danger: string;
}

export const LIGHT_TOKENS: ViewerTokens = {
  fg: "#1c1c1c",
  bg: "#ffffff",
  muted: "#595959",
  surface: "#f6f6f6",
  surface2: "#ececec",
  border: "#dddddd",
  link: "#0b57d0",
  focus: "#0b57d0",
  danger: "#b3261e",
};

export const DARK_TOKENS: ViewerTokens = {
  fg: "#e8e8e8",
  bg: "#121212",
  muted: "#a8a8a8",
  surface: "#1e1e1e",
  surface2: "#2a2a2a",
  border: "#3a3a3a",
  link: "#8ab4f8",
  focus: "#8ab4f8",
  danger: "#f2b8b5",
};

/** Badge fill. White 12 px bold text on it is 5.18:1; the halo's #e8590c gave 3.58:1. */
export const BADGE_FILL = "#c2410c";

/** `--fg: #1c1c1c; ...` for one token set, in a fixed key order so the output is stable. */
export function tokenCss(t: ViewerTokens): string {
  return (Object.keys(LIGHT_TOKENS) as Array<keyof ViewerTokens>)
    .map((k) => `--${k}: ${t[k]};`)
    .join(" ");
}

export const VIEWER_STYLE = `
  :root { ${tokenCss(LIGHT_TOKENS)} color-scheme: light dark; font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: var(--fg); background: var(--bg); }
  @media (prefers-color-scheme: dark) { :root { ${tokenCss(DARK_TOKENS)} } }
  body { margin: 0; padding: 2rem; max-width: 980px; margin-inline: auto; }
  a { color: var(--link); }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  .step { margin: 1.5rem 0 2.5rem; border-radius: 6px; }
  .shot { position: relative; display: inline-block; border: 1px solid var(--border); max-width: 100%; }
  /* width/height attributes plus height:auto reserve the image's box before it loads; the surface colour shows meanwhile. */
  .shot img { display: block; max-width: 100%; height: auto; background: var(--surface); }
  /* Default: a blinking halo around the target (+ a numbered badge when a screenshot has > 1 call-out) —
     does NOT cover the UI. The callout text is hidden until you hover, focus or tap the halo or its badge. */
  .sd-ann { position: absolute; left: 0; top: 0; pointer-events: none; }
  .sd-halo { position: absolute; box-sizing: border-box; border: 2px solid #e8590c; border-radius: 4px; box-shadow: 0 0 0 3px rgba(232,89,12,.35); cursor: help; pointer-events: auto; background: transparent; margin: 0; padding: 0; font: inherit; color: inherit; -webkit-appearance: none; appearance: none; }
  /* At least 44 x 44 px to tap, however small the target. */
  .sd-halo::before { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, 44px); height: max(100%, 44px); transform: translate(-50%, -50%); }
  /* Two-tone ring: visible on any screenshot colour. */
  .sd-halo:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 5px #0b57d0; }
  /* The pulse is a separate ring that only changes opacity, so it never moves anything and the browser can composite it. */
  .sd-halo::after { content: ""; position: absolute; inset: -8px; border: 3px solid rgba(232,89,12,.3); border-radius: 8px; pointer-events: none; animation: sd-pulse 1.7s ease-in-out infinite; }
  .sd-halo:focus-visible::after { display: none; }
  @keyframes sd-pulse { 0%,100% { opacity: 0; } 50% { opacity: 1; } }
  .sd-badge { position: absolute; min-width: 22px; height: 22px; padding: 0 6px; line-height: 22px; text-align: center; font-weight: 700; font-size: 12px; color: #fff; background: ${BADGE_FILL}; border: 2px solid #fff; border-radius: 11px; box-sizing: content-box; box-shadow: 0 2px 6px rgba(0,0,0,.32); pointer-events: auto; cursor: help; }
  .sd-callout, .sd-arrow { position: absolute; display: none; z-index: 3; pointer-events: none; }
  .sd-callout { background: #1c1c1c; color: #fff; padding: 8px 11px; border-radius: 7px; font-size: .85rem; line-height: 1.35; box-shadow: 0 4px 14px rgba(0,0,0,.32); overflow-wrap: anywhere; }
  .sd-arrow { width: 0; height: 0; }
  .sd-arrow.top { border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 8px solid #1c1c1c; }       /* callout above → arrow points down */
  .sd-arrow.bottom { border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 8px solid #1c1c1c; } /* callout below → arrow points up */
  .sd-arrow.left { border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-left: 8px solid #1c1c1c; }     /* callout left → arrow points right */
  .sd-arrow.right { border-top: 7px solid transparent; border-bottom: 7px solid transparent; border-right: 8px solid #1c1c1c; }   /* callout right → arrow points left */
  .sd-badge::before { content: ""; position: absolute; inset: -11px; }
  .sd-ann:hover .sd-callout, .sd-ann:hover .sd-arrow, .sd-ann:focus-within .sd-callout, .sd-ann:focus-within .sd-arrow, .sd-ann.sd-open .sd-callout, .sd-ann.sd-open .sd-arrow { display: block; }
  .sd-ann.sd-dismissed .sd-callout, .sd-ann.sd-dismissed .sd-arrow { display: none; }
  .caption { color: var(--muted); font-size: 0.9rem; margin-top: 0.5rem; }
  ol.caption-list { color: var(--muted); font-size: 0.9rem; margin: 0.5rem 0 0; padding-left: 1.5rem; }
  ol.caption-list li { margin: 0.15rem 0; }
  details { margin-top: 0.5rem; } pre { white-space: pre-wrap; background: var(--surface); padding: 0.75rem; border-radius: 6px; }
  .md { background: var(--surface); padding: 0.25rem 1rem; border-radius: 6px; font-size: 0.9rem; }
  .md h3, .md h4, .md h5, .md h6 { font-size: 1rem; margin: 0.75rem 0 0.25rem; }
  .md p, .md ul, .md ol { margin: 0.5rem 0; }
  .md pre { background: var(--surface2); }
  .md code { background: var(--surface2); padding: 0 3px; border-radius: 3px; }
  nav a { display: block; padding: 0.25rem 0; }
  .meta { color: var(--muted); font-size: 0.8rem; }
  .flow-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin: 1.5rem 0 0; padding: 0; list-style: none; }
  .flow-card { display: block; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; text-decoration: none; color: inherit; background: var(--bg); }
  .flow-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.12); }
  .flow-card img { display: block; width: 100%; height: 130px; object-fit: cover; object-position: top left; background: var(--surface); border-bottom: 1px solid var(--border); }
  .flow-card .thumb-missing { height: 130px; display: grid; place-items: center; color: var(--muted); font-size: .8rem; background: var(--surface); border-bottom: 1px solid var(--border); }
  .flow-card-meta { padding: .6rem .75rem; } .flow-card-meta strong { display: block; } .flow-card-meta span { color: var(--muted); font-size: .8rem; }
  .skip-link { position: absolute; left: 1rem; top: -100px; padding: .5rem .75rem; background: var(--bg); color: var(--fg); border: 1px solid var(--fg); border-radius: 6px; z-index: 10; }
  .skip-link:focus { top: 1rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  main:focus, .step:focus:not(:focus-visible) { outline: none; }
  .shot-figure { margin: 0; }
  .site-footer { margin-top: 2rem; }
  .empty { color: var(--muted); }
  .flow-nav { display: flex; flex-wrap: wrap; gap: 0 1.25rem; margin: 0; padding: 0; list-style: none; }
  .shortcuts { font-size: .9rem; } .shortcuts p { color: var(--muted); margin: .5rem 0; }
  .shortcuts dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0; }
  .shortcuts dl div { display: contents; } .shortcuts dd { margin: 0; }
  kbd { font: .85em ui-monospace, monospace; padding: 0 .35em; border: 1px solid var(--muted); border-radius: 4px; background: var(--surface); }
  .shot-missing { margin: 0; padding: 2rem 1rem; text-align: center; color: var(--muted); background: var(--surface); border: 1px dashed var(--muted); border-radius: 6px; }
  .shot-error { color: var(--danger); margin: .5rem 0 0; }
  .shot-error[hidden] { display: none; }
  .shot.is-broken { border-color: var(--danger); }
  button.shot-retry { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--fg); border-radius: 6px; padding: .25rem .75rem; min-height: 44px; min-width: 44px; cursor: pointer; }
  .notice { color: var(--fg); background: var(--surface); border-left: 4px solid var(--danger); padding: .5rem .75rem; border-radius: 0 6px 6px 0; }
  h1, h2 { overflow-wrap: anywhere; }
  /* Touch targets of at least 44 px for the page's own controls. */
  .flow-nav a { display: inline-flex; align-items: center; min-height: 44px; padding: 0; }
  summary { padding: 10px 0; min-height: 44px; box-sizing: border-box; cursor: pointer; }
  @media (max-width: 600px) {
    body { padding: 1rem; }
    h2 { margin-top: 1.75rem; }
    .step { margin: 1rem 0 2rem; }
    .flow-grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { .sd-halo::after { animation: none; opacity: 0; } }
  /* Print: light colours, no page chrome, no overlay (its positions are screen pixels; the captions
     carry the same text), figures kept whole. Write-ups are opened by the runtime before printing. */
  @media print {
    :root { --fg: #000000; --bg: #ffffff; --muted: #333333; --surface: #ffffff; --surface2: #f2f2f2; --border: #999999; --link: #000000; color-scheme: light; }
    body { max-width: none; padding: 0; }
    .skip-link, .site-header, .sd-ann, .shot-error { display: none !important; }
    h2 { break-after: avoid; }
    .shot-figure { break-inside: avoid; }
    .md { border: 1px solid var(--border); }
  }
`;
