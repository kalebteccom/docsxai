// Unit tests for the in-page settle poll, run against a stubbed page: a scripted element tree,
// a scripted font state and a rAF built on timers. The keystone proves the same poll on Chromium.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitSettled,
  runSettle,
  settleFailure,
  SETTLE_DEFAULT_TIMEOUT_MS,
  SETTLE_MAX_VISITED,
  SETTLE_POLL_INTERVAL_MS,
  SETTLE_STABLE_POLLS,
  type SettleArgs,
} from "../src/page-settle.js";

interface StubEl {
  tagName: string;
  complete?: boolean;
  children: StubEl[];
  shadowRoot: { children: StubEl[] } | null;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});
const el = (
  rect: () => ReturnType<typeof box>,
  extra: Partial<StubEl> = {},
  children: StubEl[] = [],
): StubEl => ({
  tagName: "DIV",
  children,
  shadowRoot: null,
  getBoundingClientRect: rect,
  ...extra,
});

const globals = globalThis as Record<string, unknown>;
afterEach(() => {
  for (const k of ["document", "innerWidth", "innerHeight", "requestAnimationFrame"]) {
    delete globals[k];
  }
});

function stubPage(body: StubEl, fonts?: { status: string; ready: Promise<unknown> }) {
  globals.document = { body, fonts };
  globals.innerWidth = 800;
  globals.innerHeight = 600;
  globals.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 1);
}

const args = (over: Partial<SettleArgs> = {}): SettleArgs => ({
  timeoutMs: 1000,
  pollMs: 5,
  stablePolls: SETTLE_STABLE_POLLS,
  maxVisited: SETTLE_MAX_VISITED,
  ...over,
});

describe("awaitSettled", () => {
  it("settles on a still page after the first read plus two calm polls", async () => {
    stubPage(el(() => box(0, 0, 800, 100), {}, [el(() => box(10, 10, 100, 20))]));
    const out = await awaitSettled(args());
    expect(out).toEqual({ settled: true, polls: 3, pending: [], pendingImages: 0 });
  });

  it("waits out a layout that moves for a few polls", async () => {
    let reads = 0;
    stubPage(el(() => box(0, 0, 800, ++reads < 6 ? 100 + reads * 10 : 200)));
    const out = await awaitSettled(args());
    expect(out.settled).toBe(true);
    expect(out.polls).toBeGreaterThanOrEqual(6);
  });

  it("treats sub-pixel jitter as still", async () => {
    let reads = 0;
    stubPage(el(() => box(0, 0, 800, 100 + (reads++ % 2) * 0.4)));
    expect((await awaitSettled(args())).settled).toBe(true);
  });

  it("does not settle while an image inside the viewport is loading, and names it", async () => {
    stubPage(
      el(() => box(0, 0, 800, 100), {}, [
        el(() => box(0, 0, 50, 50), { tagName: "IMG", complete: false }),
      ]),
    );
    const out = await awaitSettled(args({ timeoutMs: 80 }));
    expect(out).toMatchObject({ settled: false, pending: ["images"], pendingImages: 1 });
  });

  it("ignores a loading image that is below the viewport", async () => {
    stubPage(
      el(() => box(0, 0, 800, 100), {}, [
        el(() => box(0, 900, 50, 50), { tagName: "IMG", complete: false }),
      ]),
    );
    expect((await awaitSettled(args())).settled).toBe(true);
  });

  it("counts a loading image that has no size yet, but not a display:none one", async () => {
    const unsized = el(() => box(20, 30, 0, 0), { tagName: "IMG", complete: false });
    stubPage(el(() => box(0, 0, 800, 100), {}, [unsized]));
    expect(await awaitSettled(args({ timeoutMs: 80 }))).toMatchObject({
      settled: false,
      pendingImages: 1,
    });
    const hidden = el(() => box(0, 0, 0, 0), { tagName: "IMG", complete: false });
    stubPage(el(() => box(0, 0, 800, 100), {}, [hidden]));
    expect((await awaitSettled(args())).settled).toBe(true);
  });

  it("reads open shadow roots", async () => {
    const inner = el(() => box(0, 0, 50, 50), { tagName: "IMG", complete: false });
    stubPage(
      el(() => box(0, 0, 800, 100), {}, [
        el(() => box(0, 0, 10, 10), { shadowRoot: { children: [inner] } }),
      ]),
    );
    expect((await awaitSettled(args({ timeoutMs: 80 }))).pending).toEqual(["images"]);
  });

  it("does not settle while fonts are loading, then settles once they finish", async () => {
    const fonts = { status: "loading", ready: Promise.resolve() };
    stubPage(
      el(() => box(0, 0, 800, 100)),
      fonts,
    );
    setTimeout(() => (fonts.status = "loaded"), 40);
    const out = await awaitSettled(args());
    expect(out.settled).toBe(true);
    const stuck = { status: "loading", ready: Promise.resolve() };
    stubPage(
      el(() => box(0, 0, 800, 100)),
      stuck,
    );
    expect(await awaitSettled(args({ timeoutMs: 60 }))).toMatchObject({
      settled: false,
      pending: ["fonts"],
    });
  });

  it("returns by the deadline when the layout never stops moving, with a bounded poll count", async () => {
    let reads = 0;
    stubPage(el(() => box(0, 0, 800, 100 + ++reads)));
    const started = Date.now();
    const out = await awaitSettled(args({ timeoutMs: 100, pollMs: 10 }));
    expect(out).toMatchObject({ settled: false, pending: ["layout"] });
    expect(out.polls).toBeLessThanOrEqual(10);
    expect(Date.now() - started).toBeLessThan(600);
  });

  it("stops reading boxes at maxVisited", async () => {
    let reads = 0;
    const many = Array.from({ length: 50 }, () => el(() => (reads++, box(0, 0, 10, 10))));
    stubPage(el(() => box(0, 0, 800, 100), {}, many));
    await awaitSettled(args({ maxVisited: 10 }));
    expect(reads).toBeLessThanOrEqual(10 * 3 + 3);
  });
});

describe("settleFailure", () => {
  it("names the budget, the poll count and each thing still unsettled", () => {
    expect(
      settleFailure(3000, {
        settled: false,
        polls: 41,
        pending: ["fonts", "images", "layout"],
        pendingImages: 2,
      }),
    ).toBe(
      "settled: page did not settle within 3000 ms after 41 poll(s): web fonts still loading; 2 visible image(s) still loading; layout of the visible elements still changing",
    );
  });

  it("keeps the fixed prefix the runtime's halt-cause hint matches", () => {
    expect(settleFailure(100, { settled: false, polls: 1, pending: [], pendingImages: 0 })).toMatch(
      /^settled: page did not settle within 100 ms/,
    );
  });

  it("exposes the defaults the driver and docs quote", () => {
    expect([SETTLE_DEFAULT_TIMEOUT_MS, SETTLE_POLL_INTERVAL_MS, SETTLE_STABLE_POLLS]).toEqual([
      10_000, 50, 2,
    ]);
  });
});

describe("runSettle", () => {
  it("passes the fixed poll settings and the budget to the evaluate callback", async () => {
    const seen: SettleArgs[] = [];
    await runSettle(async (a) => {
      seen.push(a);
      return { settled: true, polls: 3, pending: [], pendingImages: 0 };
    }, 2500);
    expect(seen).toEqual([
      { timeoutMs: 2500, pollMs: 50, stablePolls: 2, maxVisited: SETTLE_MAX_VISITED },
    ]);
  });

  it("uses the default budget when the step sets none", async () => {
    let budget = 0;
    await runSettle(async (a) => {
      budget = a.timeoutMs;
      return { settled: true, polls: 3, pending: [], pendingImages: 0 };
    });
    expect(budget).toBe(SETTLE_DEFAULT_TIMEOUT_MS);
  });

  it("rejects with the settle message when the page did not settle", async () => {
    await expect(
      runSettle(
        async () => ({ settled: false, polls: 9, pending: ["images"], pendingImages: 2 }),
        400,
      ),
    ).rejects.toThrow(
      "settled: page did not settle within 400 ms after 9 poll(s): 2 visible image(s) still loading",
    );
  });

  it("gives up on a page that never answers, two seconds after the budget", async () => {
    vi.useFakeTimers();
    try {
      const result = runSettle(() => new Promise(() => undefined), 300);
      const assertion = expect(result).rejects.toThrow(
        /did not settle within 300 ms \(the page stopped responding\)/,
      );
      await vi.advanceTimersByTimeAsync(2300);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
