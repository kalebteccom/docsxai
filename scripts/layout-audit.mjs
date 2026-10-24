#!/usr/bin/env node
// Layout audit for the docs site and the viewer, run by hand on a machine with Chromium. It opens
// each page at eight widths, portrait and landscape, and reports:
//   - horizontal page overflow (the scrolling element is wider than the viewport),
//   - elements whose box runs past the left or right edge of the viewport and that no ancestor
//     clips (an ancestor with overflow-x other than visible is a scroller or a crop, so its
//     children are skipped),
//   - centring: for each element marked data-center (its child is the value as a selector, or its
//     first element child) and each pair in the config, the child's centre must sit within 1 px of
//     the parent's centre on both axes, and the left and right insets must differ by at most 1 px.
// It prints one table and exits 1 when it finds anything, 2 on a usage error.
//
//   node scripts/layout-audit.mjs --url https://docsxai.dev/ [--path /getting-started/quickstart/]...
//   node scripts/layout-audit.mjs --dir website/dist [--path /]... [--config layout.json]
//
// The config is JSON: { "paths": ["/"], "center": [{ "parent": "css", "child": "css" }],
// "ignore": ["css"] }. Paths given with --path win over the config's. Playwright comes from
// @docsxai/engine's playwright-core, like scripts/visual-capture.mjs.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** The audited widths, in CSS px. */
export const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1920];

/**
 * Viewports for one width. The width stays the one named; portrait is 16:9 tall and landscape
 * 9:16 short, so a phone width in landscape shows a short window with the keyboard-open height.
 */
export function viewportsFor(width) {
  return [
    { width, height: Math.round((width * 16) / 9), orientation: "portrait" },
    { width, height: Math.max(240, Math.round((width * 9) / 16)), orientation: "landscape" },
  ];
}

/** Every viewport the audit opens: eight widths, each portrait and landscape. */
export function allViewports(widths = WIDTHS) {
  return widths.flatMap(viewportsFor);
}

/** True when the page scrolls sideways: scrollWidth beyond clientWidth by more than `tol` px. */
export function pageOverflows(scrollWidth, clientWidth, tol = 0) {
  return scrollWidth - clientWidth > tol;
}

/**
 * How far a box runs past the viewport's left or right edge, in px, or null when it fits.
 * `box` is a DOMRect-like { x, width }; a zero-width box never counts.
 */
export function horizontalSpill(box, viewportWidth, tol = 0.5) {
  if (!(box.width > 0)) return null;
  const left = -box.x;
  const right = box.x + box.width - viewportWidth;
  const spill = Math.max(left, right);
  return spill > tol ? Math.round(spill * 10) / 10 : null;
}

/**
 * Centring of `child` inside `parent` (DOMRect-like boxes). dx and dy are the child's centre minus
 * the parent's, insetDelta the left inset minus the right one. `ok` when all three are within `tol`.
 */
export function centring(parent, child, tol = 1) {
  const r = (n) => Math.round(n * 10) / 10;
  const dx = r(child.x + child.width / 2 - (parent.x + parent.width / 2));
  const dy = r(child.y + child.height / 2 - (parent.y + parent.height / 2));
  const insetLeft = child.x - parent.x;
  const insetRight = parent.x + parent.width - (child.x + child.width);
  const insetDelta = r(insetLeft - insetRight);
  const ok = Math.abs(dx) <= tol && Math.abs(dy) <= tol && Math.abs(insetDelta) <= tol;
  return { dx, dy, insetDelta, ok };
}

/** The findings as an aligned plain-text table. */
export function formatTable(rows) {
  const head = ["page", "viewport", "kind", "element", "detail"];
  const body = rows.map((f) => [f.page, f.viewport, f.kind, f.element, f.detail]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...body.map((row) => String(row[i]).length)),
  );
  const line = (cells) =>
    cells
      .map((c, i) => String(c).padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/** Normalise a parsed config file; unknown keys are ignored. */
export function readConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);
  const center = Array.isArray(cfg.center)
    ? cfg.center.filter((c) => c && typeof c.parent === "string" && typeof c.child === "string")
    : [];
  return { paths: list(cfg.paths), center, ignore: list(cfg.ignore) };
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** A static server for a built directory on 127.0.0.1, a random port. */
async function serve(dir) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const clean = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = clean.endsWith("/") ? `${clean}index.html` : clean;
    const file = join(root, rel);
    if (file.startsWith(root) && (await isFile(file))) {
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(await readFile(file));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// Runs in the page: boxes for the spill and centring checks. Kept free of closures over Node code.
function collect({ center, ignore }) {
  const { document, getComputedStyle } = globalThis;
  const ignored = (el) => ignore.some((sel) => el.closest(sel));
  const name = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("");
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const clippedByAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== "visible") return true;
    }
    return false;
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const se = document.scrollingElement ?? document.documentElement;
  const elements = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || ignored(el) || clippedByAncestor(el)) continue;
    elements.push({ name: name(el), box: box(el) });
  }
  const pairs = [];
  for (const el of document.querySelectorAll("[data-center]")) {
    const sel = el.getAttribute("data-center");
    const child = sel ? el.querySelector(sel) : el.firstElementChild;
    if (child) pairs.push({ name: name(el), parent: box(el), child: box(child) });
  }
  for (const { parent, child } of center) {
    for (const p of document.querySelectorAll(parent)) {
      const c = p.querySelector(child);
      if (c && visible(p))
        pairs.push({ name: `${name(p)} > ${child}`, parent: box(p), child: box(c) });
    }
  }
  return { scrollWidth: se.scrollWidth, clientWidth: se.clientWidth, elements, pairs };
}

/** Findings for one page at one viewport, from the boxes `collect` returned. */
export function findingsFor(page, viewport, data) {
  const vp = `${viewport.width}x${viewport.height} ${viewport.orientation}`;
  const out = [];
  if (pageOverflows(data.scrollWidth, data.clientWidth)) {
    out.push({
      page,
      viewport: vp,
      kind: "page-overflow",
      element: "document",
      detail: `scrollWidth ${data.scrollWidth} > clientWidth ${data.clientWidth}`,
    });
  }
  for (const el of data.elements) {
    const spill = horizontalSpill(el.box, data.clientWidth);
    if (spill !== null) {
      out.push({
        page,
        viewport: vp,
        kind: "spill",
        element: el.name,
        detail: `${spill}px past the edge`,
      });
    }
  }
  for (const p of data.pairs) {
    const c = centring(p.parent, p.child);
    if (!c.ok) {
      out.push({
        page,
        viewport: vp,
        kind: "off-centre",
        element: p.name,
        detail: `dx ${c.dx} dy ${c.dy} inset L-R ${c.insetDelta}`,
      });
    }
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      dir: { type: "string" },
      path: { type: "string", multiple: true },
      config: { type: "string" },
    },
  });
  if (!values.url === !values.dir) {
    console.error("layout-audit: pass exactly one of --url <origin> or --dir <built-dir>");
    return 2;
  }
  const config = readConfig(values.config ? JSON.parse(await readFile(values.config, "utf8")) : {});
  const paths = values.path?.length ? values.path : config.paths.length ? config.paths : ["/"];

  const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
  const { chromium } = engineRequire("playwright-core");
  const served = values.dir ? await serve(values.dir) : null;
  const origin = served ? served.origin : values.url.replace(/\/$/, "");
  const browser = await chromium.launch();
  const findings = [];
  try {
    for (const viewport of allViewports()) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: "reduce",
        hasTouch: viewport.width < 768,
        isMobile: viewport.width < 768,
      });
      const page = await context.newPage();
      for (const p of paths) {
        await page.goto(`${origin}${p}`, { waitUntil: "load" });
        const data = await page.evaluate(collect, { center: config.center, ignore: config.ignore });
        findings.push(...findingsFor(p, viewport, data));
      }
      await context.close();
    }
  } finally {
    await browser.close();
    served?.server.close();
  }
  if (findings.length === 0) {
    console.log(
      `layout-audit: ${paths.length} page(s) x ${allViewports().length} viewports, no findings`,
    );
    return 0;
  }
  console.log(formatTable(findings));
  console.log(`\nlayout-audit: ${findings.length} finding(s)`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main());
}
