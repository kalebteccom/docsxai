// A BrowserDriver that records every call and succeeds at everything (every selector visible, every
// success check true) unless told to fail. Shared by the matrix runtime tests.

import type { BoundingBox } from "../src/doc-pack.js";
import type { ActionableState, BrowserDriver, ResolvedRedaction } from "../src/flow-runtime.js";
import type { NearbyBoxes } from "../src/obstacles.js";

export class RecordingDriver implements BrowserDriver {
  calls: string[] = [];
  /** Selectors whose click throws. */
  failClicks = new Set<string>();
  url = "https://app.example/";

  private rec(s: string): void {
    this.calls.push(s);
  }
  async goto(url: string) {
    this.rec(`goto ${url}`);
    this.url = url;
  }
  async click(s: string) {
    this.rec(`click ${s}`);
    if (this.failClicks.has(s)) throw new Error(`element is not visible: ${s}`);
  }
  async fill(s: string, v: string) {
    this.rec(`fill ${s}=${v}`);
  }
  async upload(s: string, v: string) {
    this.rec(`upload ${s}=${v}`);
  }
  async press(s: string | null, k: string) {
    this.rec(`press ${s ?? "<page>"} ${k}`);
  }
  async hover(s: string) {
    this.rec(`hover ${s}`);
  }
  async selectOption(s: string, v: string) {
    this.rec(`select ${s}=${v}`);
  }
  async setChecked(s: string, c: boolean) {
    this.rec(`setChecked ${s}=${c}`);
  }
  async hideElements(s: string) {
    this.rec(`hide ${s}`);
  }
  async showElements(s: string | null) {
    this.rec(`show ${s ?? "<all>"}`);
  }
  async waitForNetworkIdle() {
    this.rec("waitNetworkIdle");
  }
  async waitForLoad() {
    this.rec("waitLoad");
  }
  async waitForElementStable(s: string) {
    this.rec(`waitStable ${s}`);
  }
  async waitForSettled() {
    this.rec("waitSettled");
  }
  async waitForSelector(s: string) {
    this.rec(`waitSelector ${s}`);
  }
  async waitForTimeout(ms: number) {
    this.rec(`waitTimeout ${ms}`);
  }
  async isVisible() {
    return true;
  }
  async urlMatches() {
    return true;
  }
  async textContains() {
    return true;
  }
  async currentUrl() {
    return this.url;
  }
  async count() {
    return 1;
  }
  async textOf() {
    return null;
  }
  async boundingBox(): Promise<BoundingBox | null> {
    return { x: 10, y: 20, width: 30, height: 40 };
  }
  async nearbyBoxes(): Promise<NearbyBoxes | null> {
    return null;
  }
  screenshots: string[] = [];
  async screenshot(p: string, _redactions: ResolvedRedaction[] = []) {
    this.rec(`screenshot ${p}`);
    this.screenshots.push(p);
  }
  async actionable(): Promise<ActionableState> {
    return "actionable";
  }
}
