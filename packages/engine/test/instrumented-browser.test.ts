import { describe, expect, it } from "vitest";
import { ManualCaptureStrategy } from "../src/auth.js";
import { PlaywrightInstrumentedBrowser, SECURITY_LOWERED_ARGS } from "../src/playwright-instrumented-browser.js";

describe("PlaywrightInstrumentedBrowser", () => {
  it("constructs without launching a browser", () => {
    const b = new PlaywrightInstrumentedBrowser();
    expect(b).toBeInstanceOf(PlaywrightInstrumentedBrowser);
  });

  it("accepts a connectOverCdp option (attach to a running Chrome instead of launching one)", () => {
    const b = new PlaywrightInstrumentedBrowser({ connectOverCdp: "http://localhost:9222" });
    expect(b).toBeInstanceOf(PlaywrightInstrumentedBrowser);
  });

  it("accepts a profileDir option (persistent profile — login survives between captures)", () => {
    const b = new PlaywrightInstrumentedBrowser({ profileDir: "/tmp/site-docs-chrome-profile" });
    expect(b).toBeInstanceOf(PlaywrightInstrumentedBrowser);
  });

  it("uses security-lowered Chromium args (so the injected capture helper works across SSO redirects)", () => {
    expect(SECURITY_LOWERED_ARGS).toContain("--disable-web-security");
    expect(SECURITY_LOWERED_ARGS).toContain("--disable-features=IsolateOrigins,site-per-process");
  });

  it("waitForCapture before open() throws (it's a sequencing error)", async () => {
    const b = new PlaywrightInstrumentedBrowser();
    await expect(b.waitForCapture("console")).rejects.toThrow(/open\(\) must be called/);
  });

  it("plugs into ManualCaptureStrategy as the InstrumentedBrowser factory", () => {
    const s = new ManualCaptureStrategy(() => new PlaywrightInstrumentedBrowser({ headless: true }));
    expect(s.name).toBe("manual-capture");
  });
});
