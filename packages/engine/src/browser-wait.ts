// Wait for the operator to close a headed browser (`run --pause`, `inspect --headed`). The browser
// emits `disconnected` once, so a browser that is already gone (closed during the last step) would
// never wake a wait that only listens for the event.

/** The part of a Playwright `Browser` the wait needs. */
export interface DisconnectableBrowser {
  isConnected(): boolean;
  on(event: "disconnected", listener: () => void): unknown;
}

/** Resolve when `browser` disconnects, or at once when it already has. */
export function waitForBrowserClose(browser: DisconnectableBrowser): Promise<void> {
  return new Promise<void>((resolve) => {
    // Listen first, then check: a close between the two still resolves.
    browser.on("disconnected", () => resolve());
    if (!browser.isConnected()) resolve();
  });
}
