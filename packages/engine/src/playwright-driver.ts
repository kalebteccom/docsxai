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
import { type BrowserDriver } from "./flow-runtime.js";
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
export async function launchPlaywrightSession(opts: PlaywrightSessionOptions = {}): Promise<PlaywrightSession> {
  if (opts.connectOverCdp) {
    const browser = await chromium.connectOverCDP(opts.connectOverCdp);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page = pages.find((p) => /^https?:/.test(p.url())) ?? pages[0] ?? (await context.newPage());
    const driver = new PlaywrightDriver(page, opts.docPackRoot ?? ".");
    return {
      browser,
      context,
      page,
      driver,
      storageState: () => context.storageState() as Promise<StorageState>,
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
    storageState: () => context.storageState() as Promise<StorageState>,
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
    return this.page.waitForSelector(selector, timeoutMs ? { timeout: timeoutMs } : {}).then(() => undefined);
  }
  waitForTimeout(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }

  isVisible(selector: string): Promise<boolean> {
    return this.page.locator(selector).isVisible();
  }
  async urlMatches(pattern: string): Promise<boolean> {
    return new RegExp(pattern).test(this.page.url());
  }
  async textContains(selector: string, text: string): Promise<boolean> {
    const t = (await this.page.locator(selector).first().textContent().catch(() => null)) ?? "";
    return t.includes(text);
  }

  currentUrl(): Promise<string> {
    return Promise.resolve(this.page.url());
  }
  count(selector: string): Promise<number> {
    return this.page.locator(selector).count();
  }
  textOf(selector: string): Promise<string | null> {
    return this.page.locator(selector).first().textContent().catch(() => null);
  }

  async boundingBox(selector: string, timeoutMs?: number): Promise<BoundingBox | null> {
    return this.page.locator(selector).boundingBox(timeoutMs !== undefined ? { timeout: timeoutMs } : undefined);
  }
  async screenshot(relPath: string): Promise<void> {
    const abs = path.resolve(this.docPackRoot, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await this.page.screenshot({ path: abs });
  }
}
