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
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";
import {
  VIEWPORT_PRESETS,
  type BoundingBox,
  type EnvironmentSpec,
  type ViewportSize,
} from "./doc-pack.js";
import {
  type ActionableState,
  type BrowserDriver,
  type ResolvedRedaction,
} from "./flow-runtime.js";
import { type StorageState } from "./auth.js";
import { applyRedactions, type RedactionBox } from "./redact.js";
import { resolveWorkspacePathReal } from "./workspace.js";

/**
 * Transparent pass-through to `browser.newContext` for auth mechanisms the engine doesn't model
 * itself (HTTP basic, mTLS client certs, static header tokens). The shapes mirror Playwright's
 * context options; the engine never inspects them.
 */
export interface SessionContextOptions {
  httpCredentials?: { username: string; password: string };
  clientCertificates?: unknown[];
  extraHTTPHeaders?: Record<string, string>;
}

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
  /**
   * Deterministic execution environment (a flow-file's resolved `environment` block). Locale /
   * timezone / viewport / color-scheme / reduced-motion are context options; the clock is frozen
   * via Playwright's clock API on the session's page. With `connectOverCdp` the context is
   * externally owned — only the clock applies; the rest is skipped with one stderr warning.
   */
  environment?: EnvironmentSpec;
  /** Extra `browser.newContext` options — see {@link SessionContextOptions}. Ignored with `connectOverCdp`. */
  contextOptions?: SessionContextOptions;
}

/** Map an {@link EnvironmentSpec} to the Playwright context options it pins (clock excluded — that's a page-level install). */
export function environmentContextOptions(env: EnvironmentSpec): {
  locale?: string;
  timezoneId?: string;
  viewport?: ViewportSize;
  colorScheme?: "light" | "dark";
  reducedMotion?: "reduce" | "no-preference";
} {
  const viewport = typeof env.viewport === "string" ? VIEWPORT_PRESETS[env.viewport] : env.viewport;
  return {
    ...(env.locale ? { locale: env.locale } : {}),
    ...(env.timezone ? { timezoneId: env.timezone } : {}),
    ...(viewport ? { viewport } : {}),
    ...(env.color_scheme ? { colorScheme: env.color_scheme } : {}),
    ...(env.reduced_motion !== undefined
      ? { reducedMotion: env.reduced_motion ? ("reduce" as const) : ("no-preference" as const) }
      : {}),
  };
}

async function installClock(page: Page, env: EnvironmentSpec | undefined): Promise<void> {
  if (!env?.clock) return;
  // `install({ time })` anchors the fake timers but still ticks with real time — millisecond
  // jitter between runs would break byte-identical screenshots. `setFixedTime` is what actually
  // freezes `Date`; timers keep running so timer-driven SPAs don't stall. The clock is
  // context-wide in Playwright, so one install covers every page in the session.
  await page.clock.install({ time: env.clock });
  await page.clock.setFixedTime(env.clock);
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
    // The attached context is externally owned — context-level environment fields can't apply.
    // The clock is a page-level install, so it still does.
    const skipped = (
      ["locale", "timezone", "viewport", "color_scheme", "reduced_motion"] as const
    ).filter((k) => opts.environment?.[k] !== undefined);
    if (skipped.length || opts.contextOptions) {
      process.stderr.write(
        `launchPlaywrightSession: attached over CDP — the browser context is externally owned; skipped: ${[
          ...skipped.map((k) => `environment.${k}`),
          ...(opts.contextOptions ? ["contextOptions"] : []),
        ].join(", ")}\n`,
      );
    }
    await installClock(page, opts.environment);
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
    ...(opts.environment ? environmentContextOptions(opts.environment) : {}),
    ...((opts.contextOptions ?? {}) as BrowserContextOptions),
  });
  const page = await context.newPage();
  await installClock(page, opts.environment);
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
    // Stable = two consecutive identical bounding boxes (±0.5 px), polled every 100 ms. Best-effort
    // with a 10 s budget: a perpetually-animating element proceeds after the budget rather than
    // wedging the run — Playwright's per-action stability check still guards the action itself.
    const loc = this.page.locator(selector).first();
    const deadline = Date.now() + 10_000;
    let prev: { x: number; y: number; width: number; height: number } | null = null;
    while (Date.now() < deadline) {
      const box = await loc.boundingBox({ timeout: 250 }).catch(() => null);
      if (
        box &&
        prev &&
        Math.abs(box.x - prev.x) <= 0.5 &&
        Math.abs(box.y - prev.y) <= 0.5 &&
        Math.abs(box.width - prev.width) <= 0.5 &&
        Math.abs(box.height - prev.height) <= 0.5
      ) {
        return;
      }
      prev = box;
      await this.page.waitForTimeout(100);
    }
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
  async screenshot(relPath: string, redactions: ResolvedRedaction[] = []): Promise<void> {
    // relPath segments carry flow names + step ids from the flow-file — containment-checked
    // (symlink-aware) against the doc-pack root before writing.
    const abs = await resolveWorkspacePathReal(this.docPackRoot, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // `animations: "disabled"` fast-forwards finite CSS animations/transitions to their end state
    // and cancels infinite ones, so an element transitioning in (opacity/transform) is captured
    // fully settled instead of mid-fade. `caret: "hide"` keeps a blinking text caret out of shots.
    const shotOptions = { animations: "disabled", caret: "hide" } as const;
    if (redactions.length === 0) {
      await this.page.screenshot({ path: abs, ...shotOptions });
      return;
    }
    // Redacted path: capture to a buffer, mask, then write — the unredacted bytes never hit disk.
    const boxes = await this.resolveRedactionBoxes(redactions);
    const png = await this.page.screenshot(shotOptions);
    await fs.writeFile(abs, applyRedactions(png, boxes));
  }

  /**
   * Resolve redactions to pixel rects in the screenshot's device-pixel space: selector entries via
   * {@link boundingBox} (already dpr-scaled), fixed regions scaled by the page's devicePixelRatio.
   * A selector matching nothing on-page is skipped with a warning — an absent element is vacuously
   * redacted; halting would punish flows for UI that legitimately isn't there.
   */
  private async resolveRedactionBoxes(redactions: ResolvedRedaction[]): Promise<RedactionBox[]> {
    const boxes: RedactionBox[] = [];
    let dpr: number | undefined;
    for (const r of redactions) {
      if ("selector" in r) {
        const bbox = await this.boundingBox(r.selector, 1000);
        if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
          process.stderr.write(
            `screenshot: redaction selector ${r.selector} has no visible box — skipped\n`,
          );
          continue;
        }
        boxes.push({ ...bbox, style: r.style });
      } else {
        dpr ??= await this.page.evaluate(
          () => (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1,
        );
        boxes.push({
          x: r.region.x * dpr,
          y: r.region.y * dpr,
          width: r.region.width * dpr,
          height: r.region.height * dpr,
          style: r.style,
        });
      }
    }
    return boxes;
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
