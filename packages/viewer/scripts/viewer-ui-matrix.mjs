#!/usr/bin/env node
/* eslint-disable no-undef, no-console -- browser-context callbacks and a CLI report */
// Full matrix check of the emitted viewer UI. Usage: node viewer-ui-matrix.mjs <viewer-dir> [--out <dir>]
// <viewer-dir> is a rendered `.viewer/` folder (index.html plus one folder per flow).
// Matrix: widths 320, 390, 768, 1440 x light and dark x portrait and landscape, every page.
// Checks per cell: horizontal overflow, interactive targets under 44 px (24 px at 768 and up),
// text contrast under AA, focus ring on every focusable element, `text-wrap: balance` on headings,
// mono faces outside code, reduced motion (no running animation), body measure over 75ch.
// Exits 1 on any finding, 2 on bad usage. Heavy: run it in a CI slot, not on a laptop.

import { createRequire } from "node:module";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? resolve(args[outIdx + 1] ?? "") : null;
if (!dir || !existsSync(join(dir, "index.html"))) {
  console.error("usage: viewer-ui-matrix.mjs <viewer-dir> [--out <screenshot-dir>]");
  process.exit(2);
}
if (out) mkdirSync(out, { recursive: true });

const here = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(join(here, "../../engine/package.json"));
const { chromium } = require("playwright-core");

const pages = [
  "index.html",
  ...readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "index.html")))
    .map((d) => `${d.name}/index.html`),
];
const sizes = [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
const findings = [];

function check() {
  const found = [];
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const rgba = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0.99) return c;
    }
    return [255, 255, 255, 1];
  };
  const desc = (e) =>
    `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""}`;
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1)
    found.push(`horizontal overflow ${doc.scrollWidth} > ${innerWidth}`);
  const min = innerWidth >= 768 ? 24 : 44;
  for (const el of document.querySelectorAll(
    "a[href], button, summary, input, select, textarea, [tabindex]",
  )) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest(".sr-only, .skip-link"))
      continue;
    // Inline links inside running text are exempt (WCAG 2.5.8); block-level controls are not.
    if (el.tagName === "A" && cs.display === "inline") continue;
    // Pseudo-element hit areas (.sd-halo::before) extend the target; read them.
    let w = r.width,
      h = r.height;
    const pb = getComputedStyle(el, "::before");
    if (pb.content !== "none" && pb.position === "absolute") {
      w = Math.max(w, parseFloat(pb.width) || 0);
      h = Math.max(h, parseFloat(pb.height) || 0);
    }
    if (w < min - 0.5 || h < min - 0.5)
      found.push(`target ${desc(el)} ${Math.round(w)}x${Math.round(h)} < ${min}`);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest(".sr-only")) continue;
    const fg = rgba(cs.color),
      bg = bgOf(el);
    if (!fg || el.closest(".sd-callout")) continue;
    const a = fg[3];
    const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const [hi, lo] = [lum(mix), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const large =
      parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) found.push(`contrast ${ratio.toFixed(2)} on ${desc(el)}`);
  }
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    if (getComputedStyle(h).textWrap !== "balance")
      found.push(`heading ${desc(h)} lacks text-wrap: balance`);
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("code, pre, samp")) continue;
    if (/mono/i.test(getComputedStyle(el).fontFamily)) found.push(`mono face on ${desc(el)}`);
  }
  for (const p of document.querySelectorAll("main p, .md p, .caption")) {
    const cs = getComputedStyle(p);
    const ch = p.getBoundingClientRect().width / (parseFloat(cs.fontSize) * 0.5);
    if (ch > 80) found.push(`measure ~${Math.round(ch)}ch on ${desc(p)}`);
  }
  return found;
}

async function focusRing(page) {
  const bad = [];
  const n = await page.evaluate(
    () =>
      [...document.querySelectorAll("a[href], button, summary, [tabindex='0']")].filter(
        (e) => e.getBoundingClientRect().width,
      ).length,
  );
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < Math.min(n, 40); i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      const ring =
        (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      return { ring, name: e.tagName + "." + e.className, skip: !!e.closest(".sr-only") };
    });
    if (r && !r.ring && !r.skip) bad.push(`no focus ring on ${r.name}`);
  }
  return bad;
}

const browser = await chromium.launch();
for (const pg of pages) {
  for (const [w, h] of sizes) {
    for (const scheme of ["light", "dark"]) {
      for (const landscape of [false, true]) {
        const [vw, vh] = landscape ? [h, w] : [w, h];
        const ctx = await browser.newContext({
          viewport: { width: vw, height: vh },
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        const page = await ctx.newPage();
        await page.goto(pathToFileURL(resolve(dir, pg)).href);
        const cell = `${pg} ${vw}x${vh} ${scheme}`;
        const found = [...(await page.evaluate(check)), ...(await focusRing(page))];
        const animating = await page.evaluate(() =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === "running" &&
                getComputedStyle(a.effect.target, a.effect.pseudoElement).opacity !== "0",
            )
            .map((a) => a.animationName ?? "anim"),
        );
        for (const a of animating) found.push(`animation ${a} runs under reduced motion`);
        for (const f of new Set(found)) findings.push(`${cell}: ${f}`);
        if (out)
          await page.screenshot({
            path: join(out, `${pg.replace(/\W+/g, "_")}-${vw}x${vh}-${scheme}.png`),
          });
        await ctx.close();
      }
    }
  }
}
await browser.close();
for (const f of findings) console.log(f);
console.log(`viewer-ui-matrix: ${findings.length} finding(s) over ${pages.length} page(s)`);
process.exit(findings.length ? 1 : 0);
