import * as vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ManualCaptureStrategy } from "../src/auth.js";
import {
  helperScript,
  PlaywrightInstrumentedBrowser,
  SECURITY_LOWERED_ARGS,
} from "../src/playwright-instrumented-browser.js";

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
    const b = new PlaywrightInstrumentedBrowser({ profileDir: "/tmp/docsxai-chrome-profile" });
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
    const s = new ManualCaptureStrategy(
      () => new PlaywrightInstrumentedBrowser({ headless: true }),
    );
    expect(s.name).toBe("manual-capture");
  });
});

// The injected page-side `__docsxai.capture()` helper has a tricky lifecycle: when its
// Node-side `exposeFunction` binding is gone (e.g. capture-auth detached from a shared --cdp
// Chrome), the bare-bones implementation would throw a TypeError on the page. These tests run
// the helper script in a node:vm sandbox against a mock `window` to verify the graceful path.

function runHelperInSandbox(trigger: "console" | "button", bindingPresent: boolean) {
  const info: unknown[] = [];
  const removed: string[] = [];
  // Mock `document` — buttons / removals track for the `button` trigger case.
  const document = {
    getElementById: (id: string) => {
      // Pretend the stale button exists when we want to verify removal.
      if (id === "__docsxai_btn") return { remove: () => removed.push("__docsxai_btn") };
      return null;
    },
    createElement: (_tag: string) => {
      return { id: "", textContent: "", style: { cssText: "" }, onclick: () => {} };
    },
    body: { appendChild: () => {} },
    documentElement: { appendChild: () => {} },
  };
  const win: Record<string, unknown> = {};
  if (bindingPresent) win.__docsxai_capture = () => "captured";
  const ctx: Record<string, unknown> = {
    window: win,
    document,
    console: { info: (msg: unknown) => info.push(msg) },
  };
  // Mirror the script's `window.X` writes onto the ctx for direct access in tests
  // (vm-context globals are also window-properties under the hood with this shape).
  vm.runInNewContext(helperScript(trigger), ctx);
  return { win, info, removed, ctx };
}

describe("helperScript (page-side __docsxai.capture lifecycle)", () => {
  it("installs window.__docsxai.capture which invokes the binding when present", () => {
    const r = runHelperInSandbox("console", true);
    const docsxai = r.win.__docsxai as { capture: () => unknown };
    expect(typeof docsxai.capture).toBe("function");
    expect(docsxai.capture()).toBe("captured");
  });

  it("when the backing binding is missing, capture() logs a friendly info note and returns undefined", () => {
    const r = runHelperInSandbox("console", false);
    const docsxai = r.win.__docsxai as { capture?: () => unknown };
    expect(docsxai.capture).toBeDefined();
    expect(docsxai.capture!()).toBeUndefined();
    expect(r.info).toHaveLength(1);
    expect(String(r.info[0])).toMatch(/capture helper detached/i);
  });

  it("when the backing binding is missing, capture() self-deletes from window.__docsxai", () => {
    const r = runHelperInSandbox("console", false);
    const docsxai = r.win.__docsxai as { capture?: () => unknown };
    docsxai.capture!();
    expect(docsxai.capture).toBeUndefined();
  });

  it("when the binding is missing AND a stale __docsxai_btn exists, the button is removed", () => {
    const r = runHelperInSandbox("button", false);
    const docsxai = r.win.__docsxai as { capture?: () => unknown };
    docsxai.capture!();
    expect(r.removed).toContain("__docsxai_btn");
  });

  it("doesn't double-overwrite a pre-existing window.__docsxai (preserves namespacing)", () => {
    const ctx: Record<string, unknown> = {
      window: { __docsxai: { sentinel: "preserve-me" }, __docsxai_capture: () => "x" },
      document: { getElementById: () => null },
      console: { info: () => {} },
    };
    vm.runInNewContext(helperScript("console"), ctx);
    const docsxai = (ctx.window as { __docsxai: { sentinel: string; capture: () => unknown } })
      .__docsxai;
    expect(docsxai.sentinel).toBe("preserve-me");
    expect(typeof docsxai.capture).toBe("function");
  });
});
