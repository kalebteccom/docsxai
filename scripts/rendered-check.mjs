#!/usr/bin/env node
// Rendered check for the docs site, run by hand on a machine with Chromium (like layout-audit.mjs).
// It serves a built site, opens each page at 320, 390 and 1440 CSS px in the light and dark theme,
// and reports three classes of finding. It exits 1 when it finds any, 2 on a usage error.
//   - contrast: for every visible text node, the computed foreground (opacity applied) against the
//     real background (every ancestor's background colour composited, bottom up). Under 4.5:1, or
//     under 3:1 for large text (24 px, or 18.66 px bold).
//   - target: every visible interactive element is at least 44x44 CSS px at 390 and below, and at
//     least 24x24 on a desktop pointer. A link inside running text is exempt (WCAG 2.5.8 inline
//     exception); see INLINE_EXEMPT.
//   - clip: an element that hides its overflow, has text, and is wider than its box.
//
//   node scripts/rendered-check.mjs --dir website/dist [--path /]... [--json out.json]
//   node scripts/rendered-check.mjs --url http://127.0.0.1:4321 [--path /]...
// `--width <px>` and `--theme light|dark` (both repeatable) narrow the matrix to one capture.
// The full matrix is 5 pages x 3 widths x 2 themes; run it on a CI box, not a laptop.
//
// Pages default to the landing, two getting-started pages, the CLI reference and a guide.
// Playwright comes from @docsxai/engine's playwright-core, like layout-audit.mjs.

import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { serve } from "./layout-audit.mjs";

export const PAGES = [
  "/",
  "/getting-started/installation/",
  "/getting-started/quickstart/",
  "/reference/cli/",
  "/guides/burn-theming/",
];
export const WIDTHS = [320, 390, 1440];
export const THEMES = ["light", "dark"];
/** Touch target minimum in CSS px: phones, then a desktop pointer. */
export const MIN_TOUCH = 44;
export const MIN_POINTER = 24;
export const PHONE_MAX = 767;
/**
 * Targets the target check skips. Each entry is a selector and the reason it is not a finding.
 * A text link inside a sentence or list item cannot grow without breaking the line (WCAG 2.5.8
 * inline exception); it is skipped only while it is an inline box.
 */
export const INLINE_EXEMPT = [
  {
    selector:
      ".sl-markdown-content :is(p, li, td, th, dd, dt, h1, h2, h3, h4, h5, h6, blockquote) a",
    reason: "link inside running text (WCAG 2.5.8 inline exception), inline box only",
  },
  {
    selector: "footer :is(p, li) a, .site-footer a",
    reason: "footer link inside a sentence, inline box only",
  },
];

/** Parses rgb(), rgba() and color(srgb ...) into [r, g, b, a] (0-255, 0-1), or null. */
export function parseColor(css) {
  if (!css) return null;
  let m = css.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (m) return [+m[1], +m[2], +m[3], alpha(m[4])];
  m = css.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, alpha(m[4])];
  return null;
}
function alpha(raw) {
  if (raw === undefined) return 1;
  return raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
}

/** Source-over: `top` [r,g,b,a] on an opaque `under` [r,g,b]. */
export function over(top, under) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a));
}

/** WCAG relative luminance of [r,g,b] in 0-255. */
export function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Large text: 24 px and up, or 18.66 px and up at weight 700 and up. */
export function isLarge(sizePx, weight) {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
}

/**
 * Real colours for one text element. `layers` is the element's own background colour and each
 * ancestor's, nearest first, as { color, opacity } (opacity is the product of that node's and its
 * ancestors' opacity). The canvas under everything is white. Returns { fg, bg, ratio } or null when
 * a colour could not be parsed.
 */
export function resolvePair(fgCss, fgOpacity, layers) {
  const fg0 = parseColor(fgCss);
  if (!fg0) return null;
  // A gradient layer stands for each of its stops in turn; the result is the worst pair.
  let backs = [[255, 255, 255]];
  for (const layer of [...layers].reverse()) {
    const colors = (layer.stops ?? [layer.color]).map(parseColor);
    if (colors.some((c) => !c)) return null;
    backs = backs.flatMap((under) =>
      colors.map((c) => over([c[0], c[1], c[2], c[3] * layer.opacity], under)),
    );
  }
  let worst = null;
  for (const bg of backs) {
    const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * fgOpacity], bg);
    const ratio = contrastRatio(fg, bg);
    if (!worst || ratio < worst.ratio) worst = { fg, bg, ratio };
  }
  return worst;
}

/** Minimum side for an interactive element at a viewport width. */
export function minTarget(width) {
  return width <= PHONE_MAX ? MIN_TOUCH : MIN_POINTER;
}

export function targetShort(box, width) {
  const min = minTarget(width);
  return box.width + 0.5 < min || box.height + 0.5 < min ? min : null;
}

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// Runs in the page. Free of closures over Node code.
function collect({ inlineExempt }) {
  const { document, getComputedStyle, innerWidth } = globalThis;
  const name = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("");
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const visible = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.left >= innerWidth) return false;
    return true;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };
  const text = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest("script, style, noscript, template")) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    const layers = [];
    let approx = false;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const op = opacityOf(a);
      const grad = s.backgroundImage.match(
        /(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g,
      );
      if (grad) {
        const stops = grad.flatMap((g) => g.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) ?? []);
        if (stops.length) layers.push({ stops, opacity: op });
        approx = true;
      }
      if (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") {
        layers.push({ color: s.backgroundColor, opacity: op });
        if (/^rgb\(|^color\(srgb [\d. ]+\)$/.test(s.backgroundColor)) break;
      }
    }
    text.push({
      el: name(el),
      sample: n.nodeValue.trim().slice(0, 40),
      fg: cs.color,
      fgOpacity: opacityOf(el),
      layers,
      size: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      approx,
    });
  }
  const targets = [];
  const sel =
    "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex='-1'])";
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // A visually hidden control (1 px clip) that a visible label covers is not a target.
    const exempt =
      cs.display === "inline" && inlineExempt.some((s) => el.matches(s)) ? true : false;
    targets.push({
      el: name(el),
      label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
      width: r.width,
      height: r.height,
      exempt,
      inline: cs.display === "inline",
    });
  }
  const clips = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "hidden" && cs.overflowX !== "clip") continue;
    if (el.clientWidth <= 1 || el.scrollWidth <= el.clientWidth + 1 || !el.textContent.trim())
      continue;
    if (!visible(el)) continue;
    clips.push({ el: name(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }
  const se = document.scrollingElement;
  return { text, targets, clips, scrollWidth: se.scrollWidth, clientWidth: se.clientWidth };
}

export function findingsFor(page, width, theme, data) {
  const out = [];
  const where = { page, width, theme };
  const seen = new Map();
  for (const t of data.text) {
    const pair = resolvePair(t.fg, t.fgOpacity, t.layers);
    if (!pair) {
      out.push({
        ...where,
        kind: "unparsed",
        element: t.el,
        detail: `${t.fg} ${t.layers.map((l) => l.color ?? l.stops.join(",")).join(" / ")}`,
      });
      continue;
    }
    const need = isLarge(t.size, t.weight) ? 3 : 4.5;
    if (pair.ratio + 0.005 >= need) continue;
    const key = `${t.el}|${hex(pair.fg)}|${hex(pair.bg)}`;
    const prev = seen.get(key);
    if (prev) {
      prev.count++;
      continue;
    }
    const f = {
      ...where,
      kind: "contrast",
      element: t.el,
      count: 1,
      detail: `${pair.ratio.toFixed(2)}:1 (needs ${need}) ${hex(pair.fg)} on ${hex(pair.bg)} "${t.sample}"${t.approx ? " [gradient under]" : ""}`,
    };
    seen.set(key, f);
    out.push(f);
  }
  const tseen = new Set();
  for (const t of data.targets) {
    if (t.exempt) continue;
    const min = targetShort({ width: t.width, height: t.height }, width);
    if (!min) continue;
    const key = `${t.el}|${Math.round(t.width)}x${Math.round(t.height)}`;
    if (tseen.has(key)) continue;
    tseen.add(key);
    out.push({
      ...where,
      kind: "target",
      element: t.el,
      detail: `${t.width.toFixed(1)}x${t.height.toFixed(1)} (needs ${min}) "${t.label}"`,
    });
  }
  for (const c of data.clips) {
    out.push({
      ...where,
      kind: "clip",
      element: c.el,
      detail: `scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}`,
    });
  }
  if (data.scrollWidth - data.clientWidth > 0) {
    out.push({
      ...where,
      kind: "h-scroll",
      element: "html",
      detail: `${data.scrollWidth} > ${data.clientWidth}`,
    });
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      dir: { type: "string" },
      path: { type: "string", multiple: true },
      json: { type: "string" },
      width: { type: "string", multiple: true },
      theme: { type: "string", multiple: true },
    },
  });
  if (!values.url === !values.dir) {
    console.error("rendered-check: pass exactly one of --url <origin> or --dir <built-dir>");
    return 2;
  }
  const paths = values.path?.length ? values.path : PAGES;
  const widths = values.width?.length ? values.width.map(Number) : WIDTHS;
  const themes = values.theme?.length ? values.theme : THEMES;
  if (widths.some((w) => !(w > 0)) || themes.some((t) => !THEMES.includes(t))) {
    console.error("rendered-check: --width is a number, --theme is light or dark");
    return 2;
  }
  const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
  const { chromium } = engineRequire("playwright-core");
  const served = values.dir ? await serve(values.dir) : null;
  const origin = served ? served.origin : values.url.replace(/\/$/, "");
  const browser = await chromium.launch();
  const findings = [];
  let checked = 0;
  try {
    for (const width of widths) {
      for (const theme of themes) {
        const context = await browser.newContext({
          viewport: { width, height: Math.round((width * 16) / 9) },
          reducedMotion: "reduce",
          colorScheme: theme,
          hasTouch: width <= PHONE_MAX,
          isMobile: width <= PHONE_MAX,
        });
        await context.addInitScript(
          (t) => globalThis.localStorage.setItem("starlight-theme", t),
          theme,
        );
        const page = await context.newPage();
        for (const p of paths) {
          await page.goto(`${origin}${p}`, { waitUntil: "load" });
          await page.evaluate(() => globalThis.document.fonts.ready);
          const data = await page.evaluate(collect, {
            inlineExempt: INLINE_EXEMPT.map((e) => e.selector),
          });
          checked += data.text.length;
          findings.push(...findingsFor(p, width, theme, data));
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    served?.server.close();
  }
  if (values.json) await writeFile(values.json, JSON.stringify(findings, null, 2));
  for (const f of findings) {
    console.log(
      `${f.kind.padEnd(8)} ${f.page} ${f.width} ${f.theme} ${f.element} ${f.detail}${f.count > 1 ? ` x${f.count}` : ""}`,
    );
  }
  const tally = {};
  for (const f of findings) tally[f.kind] = (tally[f.kind] ?? 0) + 1;
  console.log(
    `\nrendered-check: ${paths.length} page(s) x ${widths.length} widths x ${themes.length} themes, ${checked} text elements, ${findings.length} finding(s) ${JSON.stringify(tally)}`,
  );
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main());
}
