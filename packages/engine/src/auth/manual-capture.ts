// `manual-capture` — the zero-integration universal fallback for SSO / MFA / conditional access.

import {
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
  type StorageState,
} from "./types.js";

export type CaptureTrigger = "console" | "button";

/**
 * The browser the engine drives for `manual-capture` — a security-lowered, *instrumented* Chrome.
 * The Playwright-backed implementation lives in a separate module (so this strategy stays testable);
 * `--disable-web-security` etc. let the injected capture helper work across SSO-redirect origins.
 */
export interface InstrumentedBrowser {
  /** Launch the browser and open the target site. */
  open(baseURL: string): Promise<void>;
  /**
   * Inject the capture helper (a console function `window.__docsxai.capture()` and/or an on-page button)
   * and resolve once the human triggers it. The human does the interactive login (SSO / MFA / conditional
   * access — anything they can click through) before triggering.
   */
  waitForCapture(trigger: CaptureTrigger): Promise<void>;
  /** Snapshot the current `storageState`. */
  storageState(): Promise<StorageState>;
  close(): Promise<void>;
}

export interface ManualCaptureOptions {
  /** `console` (default): `window.__docsxai.capture()`. `button`: an injected on-page button. */
  capture_trigger?: CaptureTrigger;
}

/**
 * `manual-capture` — the plugin spawns a security-lowered, instrumented Chrome; the engineer logs in
 * interactively; a console command or an injected button snapshots `storageState`. The zero-integration
 * universal fallback for SSO / MFA / conditional access, at the cost of periodic human re-capture.
 */
export class ManualCaptureStrategy implements AuthStrategy {
  readonly name = "manual-capture" as const;
  constructor(private readonly browserFactory: () => InstrumentedBrowser) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = ctx.options as ManualCaptureOptions;
    const trigger: CaptureTrigger = opts.capture_trigger ?? "console";
    const browser = this.browserFactory();
    try {
      await browser.open(ctx.baseURL);
      await browser.waitForCapture(trigger);
      const storageState = await browser.storageState();
      // Deliberately *not* reporting an `expiresAt`: an interactive SSO login drops ephemeral IdP scratch
      // cookies whose expiry is seconds out, so `min(cookie.expires)` ≈ now and would make the cached
      // session born expired. How long a manually-captured session is trusted is the `cache.ttl` contract.
      return { storageState };
    } finally {
      await browser.close();
    }
  }
}
