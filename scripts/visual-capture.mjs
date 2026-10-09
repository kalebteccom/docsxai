#!/usr/bin/env node
// Screenshot the built docs site and a rendered viewer pack in Chromium. No CI
// step runs it today; see docs/ai-context/ux/visual-captures.md. It writes
// PNGs and a markdown summary; it compares nothing. It fails when a server
// cannot start, Chromium cannot launch or no capture succeeds. A single
// capture that fails is listed in the summary.
//
//   node scripts/visual-capture.mjs --site website/dist --viewer <dir> \
//     --empty <dir> --out <dir> [--summary <file>] [--artifact <name>]
//
// Playwright comes from @docsxai/engine's playwright-core, so this adds no
// dependency. Run `pnpm -C packages/engine exec playwright-core install chromium`
// first. Reduced motion is on, so the pulsing halo and other animations are
// frozen and two runs of the same commit give comparable images.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { candidateFiles, contentType, planCaptures, summaryMarkdown } from "./visual-plan.mjs";

const { values: args } = parseArgs({
  options: {
    site: { type: "string" },
    viewer: { type: "string" },
    empty: { type: "string" },
    out: { type: "string" },
    summary: { type: "string" },
    artifact: { type: "string", default: "visual-captures" },
  },
});
for (const k of ["site", "viewer", "empty", "out"]) {
  if (!args[k]) {
    console.error(`visual-capture: missing --${k}`);
    process.exit(2);
  }
}

const engineRequire = createRequire(new URL("../packages/engine/package.json", import.meta.url));
const { chromium } = engineRequire("playwright-core");

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** A static server on 127.0.0.1 with a random port; unknown paths get 404.html when it exists. */
async function serve(rootDir) {
  const root = resolve(rootDir);
  const server = createServer(async (req, res) => {
    for (const rel of candidateFiles(req.url ?? "/") ?? []) {
      const file = join(root, rel);
      if (await isFile(file)) {
        res.writeHead(200, { "content-type": contentType(file) });
        res.end(await readFile(file));
        return;
      }
    }
    const notFound = join(root, "404.html");
    const body = (await isFile(notFound)) ? await readFile(notFound) : "not found";
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

// Opens Starlight's search dialog, types a query and waits for Pagefind to answer.
async function search(page, query, answer) {
  await page.locator("button[data-open-modal]").first().click();
  await page.locator("site-search dialog[open]").waitFor();
  const input = page.locator(".pagefind-ui__search-input");
  await input.waitFor({ timeout: 10_000 });
  await input.fill(query);
  await page.locator(answer).first().waitFor({ timeout: 10_000 });
}

// Each action leaves the page in the state named by the shot.
const ACTIONS = {
  async tabOnce(page) {
    await page.keyboard.press("Tab");
  },
  async focusPrimary(page) {
    await page.keyboard.press("Tab");
    await page.locator("a.docsx-btn--primary").first().focus();
  },
  async followSkipLink(page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
  },
  async openSearch(page) {
    await search(page, "flow", ".pagefind-ui__result");
  },
  async searchNoResults(page) {
    await search(page, "zzqxjvw", ".pagefind-ui__message");
  },
  async openMenu(page) {
    await page.locator("starlight-menu-button button").click();
    await page.locator('starlight-menu-button[aria-expanded="true"]').waitFor();
  },
  async focusStep(page) {
    // The viewer listens on document: the arrow focuses step 1, Tab reaches its first halo.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Tab");
  },
  async breakImages(page) {
    await page.locator(".shot-error").first().waitFor();
  },
};

async function captureOne(browser, origins, item, outDir) {
  const context = await browser.newContext({
    viewport: { width: item.viewport.width, height: item.viewport.height },
    deviceScaleFactor: 1,
    isMobile: item.viewport.mobile,
    hasTouch: item.viewport.mobile,
    colorScheme: item.scheme,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    if (item.action === "breakImages") await page.route("**/screenshots/*.png", (r) => r.abort());
    await page.goto(origins[item.server] + item.path, { waitUntil: "load" });
    // Runs in the page; globalThis keeps `document` out of this Node-globals lint scope.
    await page.evaluate(() => globalThis.document.fonts.ready.then(() => true));
    if (item.action) await ACTIONS[item.action](page);
    const file = join(outDir, item.file);
    await mkdir(dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: Boolean(item.fullPage), animations: "disabled" });
    return { ...item };
  } catch (err) {
    return { ...item, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context.close();
  }
}

const servers = {
  site: await serve(args.site),
  viewer: await serve(args.viewer),
  empty: await serve(args.empty),
};
const origins = Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, v.origin]));
// Headless Chromium hides scrollbars by default; the site and the viewer style
// theirs, so keep them in the picture.
const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
const results = [];
try {
  for (const item of planCaptures()) {
    const r = await captureOne(browser, origins, item, args.out);
    console.log(`${r.error ? "FAIL" : "ok  "} ${r.file}${r.error ? `  ${r.error}` : ""}`);
    results.push(r);
  }
} finally {
  await browser.close();
  for (const { server } of Object.values(servers)) server.close();
}

const md = summaryMarkdown(results, args.artifact);
if (args.summary) await writeFile(args.summary, md + "\n", { flag: "a" });
else console.log(md);
// One failed state is reported, not fatal. No screenshot at all means the script is broken.
if (!results.some((r) => !r.error)) process.exitCode = 1;
