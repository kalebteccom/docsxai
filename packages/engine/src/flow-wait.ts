// Applying a step's `wait_for` through the driver. Changes when a wait form is added or its
// driver call changes.

import type { WaitSpec } from "./doc-pack.js";
import type { BrowserDriver } from "./flow-runtime.js";

export async function applyWait(
  driver: BrowserDriver,
  wait: WaitSpec,
  resolve: (v: string) => string,
  stepTimeoutMs?: number,
): Promise<void> {
  if (typeof wait === "string") {
    if (wait === "network_idle") return driver.waitForNetworkIdle();
    if (wait === "load") return driver.waitForLoad();
    if (wait === "settled") {
      if (!driver.waitForSettled) {
        throw new Error(
          "settled: driver has no waitForSettled (this browser driver doesn't implement it)",
        );
      }
      return driver.waitForSettled(stepTimeoutMs);
    }
    // element_stable without a selector is a no-op signal in this prototype; a real driver may track layout.
    return;
  }
  if ("selector" in wait)
    return driver.waitForSelector(resolve(wait.selector), wait.timeout_ms ?? stepTimeoutMs);
  if ("timeout_ms" in wait) return driver.waitForTimeout(wait.timeout_ms);
}
