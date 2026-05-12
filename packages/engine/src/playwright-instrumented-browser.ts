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
  /** Headed by default (the human logs in there). Set true to run headless — for automated tests only. */
  headless?: boolean;
  /** Accept self-signed / invalid TLS certs (e.g. the target app's local HTTPS dev cert). Default: false. */
  ignoreHTTPSErrors?: boolean;
  /** Extra Chromium args appended after {@link SECURITY_LOWERED_ARGS}. */
  extraArgs?: string[];
}

function helperScript(trigger: CaptureTrigger): string {
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
    window.__siteDocs.capture = function () { return window.${CAPTURE_BINDING}(); };
    ${button}
  })();`;
}

export class PlaywrightInstrumentedBrowser implements InstrumentedBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private captured: Promise<void> = Promise.resolve();
  private resolveCaptured: () => void = () => {};

  constructor(private readonly opts: PlaywrightInstrumentedBrowserOptions = {}) {}

  async open(baseURL: string): Promise<void> {
    this.captured = new Promise<void>((resolve) => {
      this.resolveCaptured = resolve;
    });
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
    return (await this.context.storageState()) as unknown as StorageState;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }
}
