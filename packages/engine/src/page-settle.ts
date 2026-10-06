// In-page poll behind `BrowserDriver.waitForSettled`.
//
// `awaitSettled` runs inside the page (Playwright serializes it with `page.evaluate`), so it must
// stay self-contained: no imports of values, no references to module scope. It is fixed engine
// code that takes four numbers and nothing else: no selector and no flow value reaches the page.
// The DOM lib isn't in this package's TypeScript config, so the few DOM shapes it touches are
// declared locally.
//
// Settled means all of these hold on {@link SETTLE_STABLE_POLLS} polls in a row: no web font is
// loading, every `<img>` inside the viewport has finished loading, and the boxes of the elements
// inside the viewport did not move between two animation frames. A poll is one animation frame
// plus a fixed pause, repeated until the budget runs out. The geometry read is a box walk over the
// light DOM and open shadow roots, capped at `maxVisited` elements so a huge page stays cheap.

/** Pause between two polls, in ms. */
export const SETTLE_POLL_INTERVAL_MS = 50;
/** Consecutive calm polls that count as settled. */
export const SETTLE_STABLE_POLLS = 2;
/** Most elements one poll reads boxes for. */
export const SETTLE_MAX_VISITED = 4000;
/** Budget when the step sets no `timeout_ms`, in ms. */
export const SETTLE_DEFAULT_TIMEOUT_MS = 10_000;

export interface SettleArgs {
  timeoutMs: number;
  pollMs: number;
  stablePolls: number;
  maxVisited: number;
}

export interface SettleOutcome {
  settled: boolean;
  /** Polls run. Capped at `ceil(timeoutMs / pollMs)`. */
  polls: number;
  /** What was still unsettled at the last poll: `fonts`, `images` and `layout`. Empty when settled. */
  pending: string[];
  /** Visible images still loading at the last poll. */
  pendingImages: number;
}

interface DomRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface DomElement {
  tagName: string;
  complete?: boolean;
  children: ArrayLike<DomElement>;
  shadowRoot: { children: ArrayLike<DomElement> } | null;
  getBoundingClientRect(): DomRect;
}
interface DomGlobals {
  document: {
    body: DomElement | null;
    fonts?: { status: string; ready: Promise<unknown> };
  };
  innerWidth: number;
  innerHeight: number;
  requestAnimationFrame(cb: () => void): number;
}

/**
 * Resolves with the page's state once it settles or the budget is spent. Every clock and promise
 * in here (`Date.now`, `setTimeout`, `document.fonts.ready`) belongs to the page and a page can
 * stall or override them, so the deadline in this function is a courtesy. The bound that holds is
 * the Node-side `budgetMs + 2000` guard in `runSettle`.
 */
export async function awaitSettled(a: SettleArgs): Promise<SettleOutcome> {
  const g = globalThis as unknown as DomGlobals;
  const deadline = Date.now() + a.timeoutMs;
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  // rAF is throttled in a hidden tab, so a timer backs the frame up and the poll still advances.
  const frame = () =>
    new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      g.requestAnimationFrame(finish);
      setTimeout(finish, 250);
    });

  /** Boxes of the viewport-visible elements as a flat number list, plus how many images still load. */
  const read = () => {
    const boxes: number[] = [];
    let pendingImages = 0;
    let visited = 0;
    const stack: DomElement[] = g.document.body ? [g.document.body] : [];
    while (stack.length > 0 && visited < a.maxVisited) {
      const el = stack.pop()!;
      visited++;
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
      if (el.shadowRoot) {
        for (let i = el.shadowRoot.children.length - 1; i >= 0; i--)
          stack.push(el.shadowRoot.children[i]!);
      }
      const r = el.getBoundingClientRect();
      // display:none (and detached) elements report a zero box at the origin; they paint nothing.
      if (r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0) continue;
      if (r.bottom < 0 || r.right < 0 || r.top >= g.innerHeight || r.left >= g.innerWidth) continue;
      // An image still loading can have no size yet, so it counts from the position it sits at.
      if (el.tagName === "IMG" && el.complete === false) pendingImages++;
      if (r.width > 0 && r.height > 0) boxes.push(r.left, r.top, r.width, r.height);
    }
    return { boxes, pendingImages };
  };
  const sameBoxes = (x: number[], y: number[]) =>
    x.length === y.length && x.every((v, i) => Math.abs(v - y[i]!) <= 0.5);

  // Fonts the page asked for so far. Fonts requested later show up as `loading` on a later poll.
  const fonts = g.document.fonts;
  if (fonts) await Promise.race([fonts.ready, pause(Math.max(0, deadline - Date.now()))]);

  let previous: number[] | null = null;
  let calm = 0;
  let polls = 0;
  let pending: string[] = ["layout"];
  let pendingImages = 0;
  const maxPolls = Math.max(1, Math.ceil(a.timeoutMs / a.pollMs));
  while (polls < maxPolls && Date.now() < deadline) {
    await frame();
    polls++;
    const now = read();
    pendingImages = now.pendingImages;
    pending = [];
    if (fonts && fonts.status === "loading") pending.push("fonts");
    if (now.pendingImages > 0) pending.push("images");
    if (previous === null || !sameBoxes(previous, now.boxes)) pending.push("layout");
    previous = now.boxes;
    calm = pending.length === 0 ? calm + 1 : 0;
    if (calm >= a.stablePolls) return { settled: true, polls, pending: [], pendingImages: 0 };
    await pause(a.pollMs);
  }
  return { settled: false, polls, pending, pendingImages };
}

/** The message a driver rejects with when the budget runs out; the runtime's halt-cause hint keys on its start. */
export function settleFailure(timeoutMs: number, outcome: SettleOutcome): string {
  const still = outcome.pending.map((p) =>
    p === "fonts"
      ? "web fonts still loading"
      : p === "images"
        ? `${outcome.pendingImages} visible image(s) still loading`
        : "layout of the visible elements still changing",
  );
  const detail = still.length > 0 ? `: ${still.join("; ")}` : "";
  return `settled: page did not settle within ${timeoutMs} ms after ${outcome.polls} poll(s)${detail}`;
}

/**
 * Run the settle poll through `evaluate` (the driver's page-evaluate of {@link awaitSettled}) and
 * reject with {@link settleFailure} when it does not settle. The in-page poll keeps its own
 * deadline; the outer timer covers a page that never answers (a blocked main thread), where that
 * deadline cannot fire.
 */
export async function runSettle(
  evaluate: (args: SettleArgs) => Promise<SettleOutcome>,
  timeoutMs?: number,
): Promise<void> {
  const budgetMs = timeoutMs ?? SETTLE_DEFAULT_TIMEOUT_MS;
  let guard: NodeJS.Timeout | undefined;
  const unresponsive = new Promise<never>((_, reject) => {
    guard = setTimeout(
      () =>
        reject(
          new Error(
            `settled: page did not settle within ${budgetMs} ms (the page stopped responding)`,
          ),
        ),
      budgetMs + 2000,
    );
  });
  try {
    const outcome = await Promise.race([
      evaluate({
        timeoutMs: budgetMs,
        pollMs: SETTLE_POLL_INTERVAL_MS,
        stablePolls: SETTLE_STABLE_POLLS,
        maxVisited: SETTLE_MAX_VISITED,
      }),
      unresponsive,
    ]);
    if (!outcome.settled) throw new Error(settleFailure(budgetMs, outcome));
  } finally {
    clearTimeout(guard);
  }
}
