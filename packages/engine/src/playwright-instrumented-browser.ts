// Playwright-backed InstrumentedBrowser — the security-lowered, instrumented Chrome `manual-capture` drives.
//
// The plugin spawns this; the engineer logs into the target site interactively (Azure AD SSO, MFA,
// conditional access — anything a human can click through); a console call `window.__siteDocs.capture()`
// (or an injected on-page button) snapshots `storageState`. `--disable-web-security` etc. let the injected
// helper work across the SSO-redirect origins and relaxed CSP. Headed by default — the human needs to see it.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { type CaptureTrigger, type InstrumentedBrowser, type StorageState } from "./auth.js";

/** Security-lowered Chromium args (see the module note). */
export const SECURITY_LOWERED_ARGS: readonly string[] = [
  "--disable-web-security",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-site-isolation-trials",
];

const CAPTURE_BINDING = "__siteDocs_capture";

export interface PlaywrightInstrumentedBrowserOptions {
  /** Headed by default (the human logs in there). Set true to run headless — for automated tests only. (Ignored when attaching.) */
  headless?: boolean;
  /** Accept self-signed / invalid TLS certs (e.g. the target app's local HTTPS dev cert). Default: false. (Ignored when attaching.) */
  ignoreHTTPSErrors?: boolean;
  /** Extra Chromium args appended after {@link SECURITY_LOWERED_ARGS}. (Ignored when attaching.) */
  extraArgs?: string[];
  /**
   * If set, launch with a **persistent profile** at this directory (a `userDataDir`) — cookies, localStorage and
   * login state survive between captures, so re-running `capture-auth` reuses the login instead of a fresh Chrome.
   * `capture-auth` defaults this to `<workspace>/.auth/chrome-profile/` (gitignored, never leaves the machine).
   * Mutually exclusive with `connectOverCdp` (attach short-circuits launching).
   */
  profileDir?: string;
  /**
   * If set, **attach to an already-running Chrome** at this CDP endpoint (e.g. `http://localhost:9222`) instead
   * of launching a fresh one. Use this to capture from the *same* Chrome the engineer is already logged into —
   * and that Claude in Chrome is driving for discovery — so they don't log in twice. Start that Chrome with
   * `--remote-debugging-port=9222 --disable-web-security --disable-features=IsolateOrigins,site-per-process --user-data-dir=<dir>`.
   * site-docs will **not** close it on `close()` — it's the engineer's session.
   */
  connectOverCdp?: string;
}

/**
 * The injected page-side helper. Self-cleans when the Node-side binding is gone (which happens
 * when the Playwright client detaches — e.g. `capture-auth` finishes and disconnects from a
 * shared `--cdp` Chrome that stays alive). Without this guard, a stale `__siteDocs.capture()`
 * call after detach throws `Function "__siteDocs_capture" is not exposed` in the page console —
 * cosmetic, but alarming to operators sharing the Chrome with another tool.
 *
 * Exported for unit-testing (run the returned script in a `vm` sandbox against a mock window).
 */
export function helperScript(trigger: CaptureTrigger): string {
  const button =
    trigger === "button"
      ? `if (!document.getElementById("__siteDocs_btn")) {
           var b = document.createElement("button");
           b.id = "__siteDocs_btn"; b.textContent = "\\u2713 Capture session for site-docs";
           b.style.cssText = "position:fixed;z-index:2147483647;right:12px;bottom:12px;padding:10px 14px;background:#1c1c1c;color:#fff;border:0;border-radius:8px;font:14px system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)";
           b.onclick = function () { window.__siteDocs.capture(); };
           (document.body || document.documentElement).appendChild(b);
         }`
      : "";
  return `(function () {
    window.__siteDocs = window.__siteDocs || {};
    window.__siteDocs.capture = function () {
      if (typeof window.${CAPTURE_BINDING} !== "function") {
        // Backing binding is gone (the Playwright client that injected this helper has detached).
        // Self-clean: drop the button + the helper, log a friendly note. Reload or re-run
        // \`site-docs capture-auth\` to install a fresh helper.
        var staleBtn = document.getElementById("__siteDocs_btn");
        if (staleBtn) staleBtn.remove();
        delete window.__siteDocs.capture;
        if (typeof console !== "undefined" && console.info) {
          console.info("[site-docs] capture helper detached; reload the page or re-run \`site-docs capture-auth\` to re-install.");
        }
        return undefined;
      }
      return window.${CAPTURE_BINDING}();
    };
    ${button}
  })();`;
}

export class PlaywrightInstrumentedBrowser implements InstrumentedBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private attached = false;
  private persistent = false;
  private captured: Promise<void> = Promise.resolve();
  private resolveCaptured: () => void = () => {};

  constructor(private readonly opts: PlaywrightInstrumentedBrowserOptions = {}) {}

  async open(baseURL: string): Promise<void> {
    this.captured = new Promise<void>((resolve) => {
      this.resolveCaptured = resolve;
    });

    if (this.opts.connectOverCdp) {
      // Attach to an already-running Chrome — the engineer's, already logged in (and being driven by Claude
      // in Chrome for discovery). One login, one browser. We never close it.
      this.attached = true;
      this.browser = await chromium.connectOverCDP(this.opts.connectOverCdp);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
      await this.context.exposeFunction(CAPTURE_BINDING, () => {
        this.resolveCaptured();
      });
      const pages = this.context.pages();
      this.page = pages.find((p) => /^https?:/.test(p.url())) ?? pages[0] ?? (await this.context.newPage());
      if (baseURL && this.page.url() === "about:blank") await this.page.goto(baseURL).catch(() => undefined);
      return;
    }

    this.attached = false;

    if (this.opts.profileDir) {
      // Launch with a persistent profile — cookies/login survive between captures.
      this.persistent = true;
      this.context = await chromium.launchPersistentContext(this.opts.profileDir, {
        headless: this.opts.headless ?? false,
        args: [...SECURITY_LOWERED_ARGS, ...(this.opts.extraArgs ?? [])],
        ...(this.opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
        ...(baseURL ? { baseURL } : {}),
      });
      this.browser = this.context.browser() ?? undefined;
      await this.context.exposeFunction(CAPTURE_BINDING, () => {
        this.resolveCaptured();
      });
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
      await this.page.goto(baseURL);
      return;
    }

    // Launch a fresh, ephemeral, security-lowered, instrumented Chrome.
    this.persistent = false;
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? false,
      args: [...SECURITY_LOWERED_ARGS, ...(this.opts.extraArgs ?? [])],
    });
    this.context = await this.browser.newContext({
      baseURL,
      ...(this.opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
    });
    // Node-side capture trigger; available on every page in the context (survives navigations).
    await this.context.exposeFunction(CAPTURE_BINDING, () => {
      this.resolveCaptured();
    });
    this.page = await this.context.newPage();
    await this.page.goto(baseURL);
  }

  async waitForCapture(trigger: CaptureTrigger): Promise<void> {
    if (!this.context || !this.page) throw new Error("open() must be called before waitForCapture()");
    const script = helperScript(trigger);
    await this.context.addInitScript(script); // future documents (incl. post-SSO-redirect)
    await this.page.evaluate(script).catch(() => undefined); // the already-loaded document too
    await this.captured;
  }

  async storageState(): Promise<StorageState> {
    if (!this.context) throw new Error("storageState() called before open()");
    const state = (await this.context.storageState()) as unknown as StorageState;
    // Belt-and-braces: Playwright's `storageState()` on a *CDP-attached* context doesn't reliably harvest
    // localStorage from already-open pages, so origins comes back `[]` for apps that keep auth/state there.
    // Read it directly off each open same-origin page and merge. (String-form `evaluate` to avoid pulling in
    // the DOM lib for the engine tsconfig.)
    for (const page of this.context.pages()) {
      try {
        const u = page.url();
        if (!/^https?:/.test(u)) continue;
        const origin = new URL(u).origin;
        const pairs = (await page.evaluate(
          "(() => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k != null) o.push([k, localStorage.getItem(k) ?? '']); } return o; })()",
        )) as Array<[string, string]>;
        if (!Array.isArray(pairs) || pairs.length === 0) continue;
        const items = pairs.map(([name, value]) => ({ name, value }));
        const existing = state.origins.find((o) => o.origin === origin);
        if (existing) {
          const known = new Set(existing.localStorage.map((e) => e.name));
          for (const it of items) if (!known.has(it.name)) existing.localStorage.push(it);
        } else {
          state.origins.push({ origin, localStorage: items });
        }
      } catch {
        // skip a page we can't read (cross-origin, closed, etc.)
      }
    }
    return state;
  }

  async close(): Promise<void> {
    if (this.attached) {
      // Don't touch the engineer's Chrome — just detach. The injected `__siteDocs` helper detects
      // the backing binding is gone on its next invocation, removes its injected button if any,
      // logs a friendly info message, and self-deletes from `window.__siteDocs.capture`. Safe to
      // share the Chrome with other automation clients.
      this.context = undefined;
      this.browser = undefined;
      this.page = undefined;
      return;
    }
    // For a persistent context, `context.close()` flushes the profile to disk and closes the browser.
    await this.context?.close().catch(() => undefined);
    if (!this.persistent) await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }
}
