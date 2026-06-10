// Playwright-backed BrowserDriver — the real execution-mode browser.
//
// Implements the {@link BrowserDriver} the flow-runtime is written against, over a Playwright
// `Page`. The runtime stays browser-agnostic; this is the one place that touches Playwright.
//
// Needs a browser binary. `playwright-core` ships the API but not the binaries — install one with
// `npx playwright install chromium` (the `playwright` CLI fetches it on demand). For execution
// against an authed site, the context is created with a captured `storageState` (see the auth layer).

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { type BoundingBox } from "./doc-pack.js";
import { type ActionableState, type BrowserDriver } from "./flow-runtime.js";
import { type StorageState } from "./auth.js";

export interface PlaywrightSessionOptions {
  /** Base URL for relative `goto` paths. */
  baseURL?: string;
  /** Captured session to seed the context with (from a calibration capture / the auth strategy). */
  storageState?: StorageState;
  /** Run headed (useful for `manual-capture` and debugging). Default: headless. */
  headed?: boolean;
  /** Accept self-signed / invalid TLS certs (e.g. an app's local HTTPS dev cert). Default: false. */
  ignoreHTTPSErrors?: boolean;
  /** Extra Chromium args (e.g. the security-lowered flags `manual-capture` uses). */
  chromiumArgs?: string[];
  /** Doc-pack root that screenshot paths are resolved against. */
  docPackRoot?: string;
  /** If set, attach to a running Chrome at this CDP endpoint (e.g. `http://localhost:9222`) instead of launching one. `close()` won't close it. */
  connectOverCdp?: string;
}

/** A launched Playwright browser + context + page, plus the driver bound to it. Call `close()` when done. */
export interface PlaywrightSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  driver: BrowserDriver;
  /** Snapshot the context's `storageState` (cookies + localStorage + sessionStorage). */
  storageState(): Promise<StorageState>;
  close(): Promise<void>;
}

/** Launch Chromium (or, with `connectOverCdp`, attach to a running one) and return a {@link PlaywrightSession}. */
export async function launchPlaywrightSession(
  opts: PlaywrightSessionOptions = {},
): Promise<PlaywrightSession> {
  if (opts.connectOverCdp) {
    const browser = await chromium.connectOverCDP(opts.connectOverCdp);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page =
      pages.find((p) => /^https?:/.test(p.url())) ?? pages[0] ?? (await context.newPage());
    const driver = new PlaywrightDriver(page, opts.docPackRoot ?? ".");
    return {
      browser,
      context,
      page,
      driver,
      storageState: () => context.storageState(),
      // Attached — don't close the browser; just let the connection drop.
      close: async () => {},
    };
  }
  const browser = await chromium.launch({
    headless: !opts.headed,
    ...(opts.chromiumArgs ? { args: opts.chromiumArgs } : {}),
  });
  // Playwright's `newContext({ storageState })` accepts the `{ cookies, origins }` object directly.
  const context = await browser.newContext({
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
    ...(opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
  });
  const page = await context.newPage();
  const driver = new PlaywrightDriver(page, opts.docPackRoot ?? ".");
  return {
    browser,
    context,
    page,
    driver,
    storageState: () => context.storageState(),
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export class PlaywrightDriver implements BrowserDriver {
  constructor(
    private readonly page: Page,
    private readonly docPackRoot = ".",
  ) {}

  goto(url: string): Promise<void> {
    return this.page.goto(url).then(() => undefined);
  }
  click(selector: string): Promise<void> {
    return this.page.click(selector);
  }
  fill(selector: string, value: string): Promise<void> {
    return this.page.fill(selector, value);
  }
  upload(selector: string, filePath: string): Promise<void> {
    return this.page.setInputFiles(selector, path.resolve(this.docPackRoot, filePath));
  }
  press(selector: string | null, key: string): Promise<void> {
    return selector ? this.page.press(selector, key) : this.page.keyboard.press(key);
  }
  hover(selector: string): Promise<void> {
    return this.page.hover(selector);
  }
  selectOption(selector: string, value: string): Promise<void> {
    return this.page.selectOption(selector, value).then(() => undefined);
  }
  setChecked(selector: string, checked: boolean): Promise<void> {
    return this.page.setChecked(selector, checked);
  }

  waitForNetworkIdle(): Promise<void> {
    return this.page.waitForLoadState("networkidle");
  }
  waitForLoad(): Promise<void> {
    return this.page.waitForLoadState("load");
  }
  async waitForElementStable(selector: string): Promise<void> {
    // Playwright auto-waits for actionable elements before actions; an explicit "stable" wait here just
    // ensures the element is attached + visible and lets layout settle briefly.
    await this.page.locator(selector).waitFor({ state: "visible" });
    await this.page.waitForTimeout(100);
  }
  waitForSelector(selector: string, timeoutMs?: number): Promise<void> {
    return this.page
      .waitForSelector(selector, timeoutMs ? { timeout: timeoutMs } : {})
      .then(() => undefined);
  }
  waitForTimeout(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }

  isVisible(selector: string): Promise<boolean> {
    return this.page.locator(selector).isVisible();
  }
  urlMatches(pattern: string): Promise<boolean> {
    return Promise.resolve(new RegExp(pattern).test(this.page.url()));
  }
  async textContains(selector: string, text: string): Promise<boolean> {
    const t =
      (await this.page
        .locator(selector)
        .first()
        .textContent()
        .catch(() => null)) ?? "";
    return t.includes(text);
  }

  currentUrl(): Promise<string> {
    return Promise.resolve(this.page.url());
  }
  count(selector: string): Promise<number> {
    return this.page.locator(selector).count();
  }
  textOf(selector: string): Promise<string | null> {
    return this.page
      .locator(selector)
      .first()
      .textContent()
      .catch(() => null);
  }

  async boundingBox(selector: string, timeoutMs?: number): Promise<BoundingBox | null> {
    // Visible rect, not the element's own rect — intersect with each clipping ancestor (overflow != visible)
    // and the viewport. Playwright's `Locator.boundingBox()` returns the element's geometry, which for an
    // element inside a scroll container includes parts that are clipped *off-screen-within-the-scroller* —
    // the screenshot doesn't show those, so a halo drawn from that rect overflows into the void.
    const loc = this.page.locator(selector).first();
    try {
      await loc.waitFor({
        state: "visible",
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      });
    } catch {
      return null;
    }
    return loc
      .evaluate((el: unknown) => {
        const e = el as {
          getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number };
          parentElement: unknown;
          ownerDocument: {
            defaultView: {
              innerWidth: number;
              innerHeight: number;
              devicePixelRatio: number;
              getComputedStyle: (n: unknown) => {
                overflow: string;
                overflowX: string;
                overflowY: string;
              };
            };
          };
        };
        const view = e.ownerDocument.defaultView;
        const r = e.getBoundingClientRect();
        let x = r.left,
          y = r.top,
          right = r.right,
          bottom = r.bottom;
        let cur = e.parentElement as {
          getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number };
          parentElement: unknown;
        } | null;
        while (cur) {
          const cs = view.getComputedStyle(cur);
          if (
            cs.overflow !== "visible" ||
            cs.overflowX !== "visible" ||
            cs.overflowY !== "visible"
          ) {
            const cr = cur.getBoundingClientRect();
            if (cr.left > x) x = cr.left;
            if (cr.top > y) y = cr.top;
            if (cr.right < right) right = cr.right;
            if (cr.bottom < bottom) bottom = cr.bottom;
          }
          cur = cur.parentElement as typeof cur;
        }
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (right > view.innerWidth) right = view.innerWidth;
        if (bottom > view.innerHeight) bottom = view.innerHeight;
        if (right <= x || bottom <= y) return null;
        // `getBoundingClientRect` + innerWidth/Height are CSS pixels; `page.screenshot()` produces a
        // *device-pixel* image (CSS × devicePixelRatio — e.g. ~2× on a Retina/zoomed Chrome attached
        // over CDP). The viewer scales the bbox by clientWidth/naturalWidth where naturalWidth is the
        // PNG's device-pixel width, so the stored bbox must be in that same device-pixel space or the
        // halo lands at CSS-coords-÷-dpr (badly mispositioned, and a wrong target rect throws the
        // callout into a clamped sliver). Scale here. dpr === 1 (headless default) → no-op.
        const dpr = view.devicePixelRatio || 1;
        return { x: x * dpr, y: y * dpr, width: (right - x) * dpr, height: (bottom - y) * dpr };
      })
      .catch(() => null);
  }
  async screenshot(relPath: string): Promise<void> {
    const abs = path.resolve(this.docPackRoot, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // `animations: "disabled"` fast-forwards finite CSS animations/transitions to their end state
    // and cancels infinite ones, so an element transitioning in (opacity/transform) is captured
    // fully settled instead of mid-fade. `caret: "hide"` keeps a blinking text caret out of shots.
    await this.page.screenshot({ path: abs, animations: "disabled", caret: "hide" });
  }

  async actionable(selector: string, timeoutMs = 300): Promise<ActionableState> {
    const loc = this.page.locator(selector);
    let count: number;
    try {
      count = await loc.count();
    } catch {
      return "not-found";
    }
    if (count === 0) return "not-found";
    if (count > 1) return "multiple-matches";

    const first = loc.first();
    try {
      const attached = await first.evaluate(
        (el: unknown) => (el as { isConnected?: boolean }).isConnected ?? false,
      );
      if (!attached) return "detached";
    } catch {
      return "detached";
    }

    const visible = await first.isVisible().catch(() => false);
    if (!visible) return "not-visible";

    // Off-screen check via the visible-rect bbox we already compute (intersects with clipping ancestors
    // + the viewport). `null` from bbox here means fully clipped — caller's most useful framing is
    // "off-screen" rather than "not-visible" since CSS-wise the element IS visible.
    const bbox = await this.boundingBox(selector, timeoutMs).catch(() => null);
    if (!bbox) return "off-screen";

    const enabled = await first.isEnabled().catch(() => true);
    if (!enabled) return "disabled";

    // "Covered" — hit-test the bbox center; if elementFromPoint returns something that isn't this
    // element or a descendant of it, another layer is on top.
    try {
      const covered = await first.evaluate((el: unknown) => {
        const e = el as {
          getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
          contains: (n: unknown) => boolean;
          ownerDocument: { elementFromPoint: (x: number, y: number) => unknown };
        };
        const r = e.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const top = e.ownerDocument.elementFromPoint(cx, cy);
        if (!top || top === el) return false;
        return !e.contains(top);
      });
      if (covered) return "covered";
    } catch {
      // ignore — covered check is best-effort
    }

    return "actionable";
  }
}
