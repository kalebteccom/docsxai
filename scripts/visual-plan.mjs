// The pure half of the visual-capture CI job: which pages and states get a
// screenshot, what each PNG is called, how tall a page capture may be, where
// to scroll for the table and bottom captures, how the static server maps a
// URL to a file, and the job summary. No browser and no file IO here, so
// visual-plan.test.mjs can check it with `node --test`.

// `maxHeight` caps a "top" capture: a long reference page taken whole came out
// 390x17950, which nobody can review.
export const VIEWPORTS = [
  { width: 390, height: 844, mobile: true, maxHeight: 2400 },
  { width: 1280, height: 800, mobile: false, maxHeight: 1600 },
];

export const SCHEMES = ["light", "dark"];

// `server` picks the static root: "site" is the built docs site, "viewer" the
// rendered sample pack, "empty" a pack with no flows. `action` names a step in
// visual-capture.mjs that puts the page into the state. `mobileOnly` shots only
// make sense at 390 px (the mobile menu exists only there).
//
// `capture` says what ends up in the PNG:
//   "viewport" (default) the viewport as the action left it,
//   "top"      the page from the top, cut at the viewport's maxHeight,
//   "table"    the viewport scrolled to the first table that overflows sideways,
//   "bottom"   the last viewport of the page, sidebar scrolled to its end too.
// `bottom: true` adds a "bottom" capture of the same page, named `<state>--bottom`.
export const SHOTS = [
  {
    surface: "docs",
    state: "home",
    server: "site",
    path: "/",
    capture: "top",
    bottom: true,
  },
  { surface: "docs", state: "skip-link", server: "site", path: "/", action: "tabOnce" },
  {
    surface: "docs",
    state: "skip-link-followed",
    server: "site",
    path: "/",
    action: "followSkipLink",
  },
  { surface: "docs", state: "primary-focus", server: "site", path: "/", action: "focusPrimary" },
  {
    surface: "docs",
    state: "wide-table",
    server: "site",
    path: "/reference/flow-file/",
    capture: "table",
    bottom: true,
  },
  { surface: "docs", state: "404", server: "site", path: "/no-such-page/", capture: "top" },
  { surface: "docs", state: "search-open", server: "site", path: "/", action: "openSearch" },
  {
    surface: "docs",
    state: "search-no-results",
    server: "site",
    path: "/",
    action: "searchNoResults",
  },
  {
    surface: "docs",
    state: "menu-open",
    server: "site",
    path: "/getting-started/quickstart/",
    action: "openMenu",
    mobileOnly: true,
  },
  { surface: "viewer", state: "index", server: "viewer", path: "/", capture: "top" },
  {
    surface: "viewer",
    state: "flow",
    server: "viewer",
    path: "/obstacles/",
    capture: "top",
    bottom: true,
  },
  {
    surface: "viewer",
    state: "focused-step",
    server: "viewer",
    path: "/obstacles/",
    action: "focusStep",
  },
  {
    surface: "viewer",
    state: "error",
    server: "viewer",
    path: "/obstacles/",
    action: "breakImages",
  },
  { surface: "viewer", state: "empty", server: "empty", path: "/", capture: "top" },
];

/**
 * One entry per PNG: every shot at every width and scheme, mobile-only shots at
 * 390 px only, and a `--bottom` sibling for each shot marked `bottom`. A "top"
 * entry carries the clip rectangle for a full-page screenshot; Playwright trims
 * it to the page when the page is shorter.
 */
export function planCaptures(shots = SHOTS, viewports = VIEWPORTS, schemes = SCHEMES) {
  const plan = [];
  for (const shot of shots) {
    const { bottom, ...base } = shot;
    const variants = [{ capture: "viewport", ...base }];
    if (bottom) variants.push({ ...base, state: `${base.state}--bottom`, capture: "bottom" });
    for (const vp of viewports) {
      if (shot.mobileOnly && !vp.mobile) continue;
      for (const scheme of schemes) {
        for (const v of variants) {
          const file = `${v.surface}/${v.state}--${vp.width}--${scheme}.png`;
          const clip =
            v.capture === "top" ? { x: 0, y: 0, width: vp.width, height: vp.maxHeight } : undefined;
          plan.push({ ...v, viewport: vp, scheme, file, ...(clip && { clip }) });
        }
      }
    }
  }
  return plan;
}

/**
 * Index of the table scroller to show: the first one wider inside than out, or
 * the first one at all when none overflows (`overflows` false). -1 when the
 * page has no table. Each measure is `{ scrollWidth, clientWidth }`.
 */
export function pickTable(measures) {
  const i = measures.findIndex((m) => m.scrollWidth > m.clientWidth + 1);
  if (i >= 0) return { index: i, overflows: true };
  return { index: measures.length ? 0 : -1, overflows: false };
}

/**
 * Window scroll position that puts a table in view below a fixed header. A
 * table that fits is centred in the space under the header. A taller one is
 * aligned by its bottom edge with `margin` px to spare, because its horizontal
 * scrollbar sits there. `top` and `bottom` are viewport-relative, as
 * getBoundingClientRect gives them.
 */
export function tableScrollY(
  { top, bottom, scrollY, viewportHeight, headerHeight = 0 },
  margin = 16,
) {
  const room = viewportHeight - headerHeight;
  const height = bottom - top;
  const y =
    height + 2 * margin <= room
      ? scrollY + top - headerHeight - (room - height) / 2
      : scrollY + bottom + margin - viewportHeight;
  return Math.max(0, Math.round(y));
}

/**
 * Files to try, in order, for a request path, relative to the static root.
 * Null when the path is malformed or climbs out of the root.
 */
export function candidateFiles(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!p.startsWith("/") || p.includes("\0") || p.includes("\\")) return null;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === "." || s === "..")) return null;
  const rel = parts.join("/");
  if (rel === "") return ["index.html"];
  if (p.endsWith("/")) return [`${rel}/index.html`];
  return [rel, `${rel}/index.html`, `${rel}.html`];
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".wasm": "application/wasm",
};

export function contentType(file) {
  const m = /\.[a-z0-9_]+$/i.exec(file);
  return (m && TYPES[m[0].toLowerCase()]) || "application/octet-stream";
}

/** Markdown for $GITHUB_STEP_SUMMARY: counts, failures, notes, and the PNG list grouped by surface. */
export function summaryMarkdown(results, artifactName, viewports = VIEWPORTS) {
  const heights = viewports
    .map((v) => `the top ${v.maxHeight} px at ${v.width} wide`)
    .join(" and ");
  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const lines = [
    "## Visual captures",
    "",
    `${ok.length} screenshots in the \`${artifactName}\` artifact (Chromium, 390 and 1280 px, light and dark). Nothing is compared or gated.`,
    "",
    `Page captures keep ${heights}. \`--bottom\` files show the last viewport of the same page, \`wide-table\` the viewport around the first table that scrolls sideways.`,
    "",
  ];
  const notes = ok.filter((r) => r.note);
  if (notes.length) {
    lines.push(`${notes.length} captures have a note:`, "");
    for (const r of notes) lines.push(`- \`${r.file}\`: ${oneLine(r.note)}`);
    lines.push("");
  }
  if (failed.length) {
    lines.push(`${failed.length} captures failed:`, "");
    for (const r of failed) lines.push(`- \`${r.file}\`: ${oneLine(r.error)}`);
    lines.push("");
  }
  for (const surface of [...new Set(ok.map((r) => r.surface))]) {
    lines.push(
      `<details><summary>${surface} (${ok.filter((r) => r.surface === surface).length})</summary>`,
      "",
    );
    for (const r of ok.filter((x) => x.surface === surface)) lines.push(`- \`${r.file}\``);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

function oneLine(text) {
  return String(text).split("\n")[0].replace(/`/g, "'").slice(0, 200);
}
