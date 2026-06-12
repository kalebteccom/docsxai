// The narrow page surface browser-driving auth strategies (ui-form, email-otp, webauthn) need.
//
// Mirrors the `InstrumentedBrowser` pattern: strategies depend on this interface so unit tests
// fake it; the Playwright-backed default launcher routes through `launchPlaywrightSession` —
// `playwright-driver.ts` stays the engine's one Playwright import site.

import { launchPlaywrightSession } from "../playwright-driver.js";
import { type StorageState } from "./types.js";

export interface AuthPageOptions {
  baseURL: string;
  /** Accept self-signed / invalid TLS (the target's local dev cert). Default false. */
  ignoreHTTPSErrors?: boolean;
}

export interface AuthPage {
  /** Navigate (relative URLs resolve against the launch baseURL). */
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  /** Resolve when the selector is visible; reject on timeout. */
  waitForSelector(selector: string, opts?: { timeoutMs?: number }): Promise<void>;
  /** Resolve when the page URL matches; reject on timeout. */
  waitForUrl(pattern: RegExp, opts?: { timeoutMs?: number }): Promise<void>;
  /** Attach a CDP WebAuthn virtual authenticator (ctap2 / internal / user-verifying) to the page. */
  enableVirtualAuthenticator(): Promise<void>;
  /** Snapshot the context's storageState. */
  storageState(): Promise<StorageState>;
  close(): Promise<void>;
}

export type AuthPageLauncher = (opts: AuthPageOptions) => Promise<AuthPage>;

/** Default launcher: a fresh headless Chromium context via the engine's Playwright session. */
export const launchAuthPage: AuthPageLauncher = async (opts) => {
  const session = await launchPlaywrightSession({
    baseURL: opts.baseURL,
    ...(opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
  });
  return {
    goto: async (url) => {
      await session.page.goto(url);
    },
    fill: (selector, value) => session.page.fill(selector, value),
    click: (selector) => session.page.click(selector),
    waitForSelector: async (selector, o) => {
      await session.page.waitForSelector(selector, {
        state: "visible",
        ...(o?.timeoutMs !== undefined ? { timeout: o.timeoutMs } : {}),
      });
    },
    waitForUrl: (pattern, o) =>
      session.page.waitForURL(pattern, o?.timeoutMs !== undefined ? { timeout: o.timeoutMs } : {}),
    enableVirtualAuthenticator: async () => {
      const cdp = await session.context.newCDPSession(session.page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
    },
    storageState: () => session.storageState(),
    close: () => session.close(),
  };
};
