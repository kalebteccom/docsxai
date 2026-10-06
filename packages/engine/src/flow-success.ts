// Checking a step's `success` criterion after its action. Changes when a criterion form is added
// or its halt message changes.

import type { SuccessSpec } from "./doc-pack.js";
import { FlowExecutionError } from "./flow-halt.js";
import type { BrowserDriver } from "./flow-runtime.js";

export async function checkSuccess(
  driver: BrowserDriver,
  success: SuccessSpec,
  resolve: (v: string) => string,
  stepId: string,
): Promise<void> {
  const at = async () => `at ${await driver.currentUrl().catch(() => "?")}`;
  if ("visible" in success) {
    const sel = resolve(success.visible);
    if (!(await driver.isVisible(sel))) {
      throw new FlowExecutionError(
        `expected ${success.visible} to be visible — ${await at()}; ${await driver.count(sel).catch(() => "?")} element(s) match the selector`,
        stepId,
      );
    }
    return;
  }
  if ("hidden" in success) {
    const sel = resolve(success.hidden);
    if (await driver.isVisible(sel)) {
      throw new FlowExecutionError(
        `expected ${success.hidden} to be hidden but a match is visible — ${await at()}; ${await driver.count(sel).catch(() => "?")} element(s) match`,
        stepId,
      );
    }
    return;
  }
  if ("url_matches" in success) {
    if (!(await driver.urlMatches(success.url_matches))) {
      throw new FlowExecutionError(
        `expected URL to match /${success.url_matches}/ — actual: ${await driver.currentUrl().catch(() => "?")}`,
        stepId,
      );
    }
    return;
  }
  if ("text_contains" in success) {
    const { selector, text } = success.text_contains;
    const sel = resolve(selector);
    if (!(await driver.textContains(sel, text))) {
      const actual = ((await driver.textOf(sel).catch(() => null)) ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      throw new FlowExecutionError(
        `expected ${selector} to contain ${JSON.stringify(text)} — ${await at()}; actual text: ${JSON.stringify(actual)}`,
        stepId,
      );
    }
  }
}
