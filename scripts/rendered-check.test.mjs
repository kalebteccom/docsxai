// Unit test for the pure helpers in rendered-check.mjs: colour parsing, compositing, WCAG
// contrast, the large-text rule and the touch and pointer target minimums. No browser.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contrastRatio,
  findingsFor,
  isLarge,
  luminance,
  minTarget,
  over,
  parseColor,
  resolvePair,
  targetShort,
} from "./rendered-check.mjs";

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

describe("colour maths", () => {
  it("parses rgb, rgba and color(srgb)", () => {
    assert.deepEqual(parseColor("rgb(10, 20, 30)"), [10, 20, 30, 1]);
    assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), [10, 20, 30, 0.5]);
    assert.deepEqual(parseColor("rgb(10 20 30 / 50%)"), [10, 20, 30, 0.5]);
    assert.deepEqual(parseColor("color(srgb 1 0 0 / 0.25)"), [255, 0, 0, 0.25]);
    assert.equal(parseColor("oklch(0.5 0.1 20)"), null);
  });
  it("composites source-over", () => {
    assert.deepEqual(over([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  });
  it("matches the WCAG reference ratios", () => {
    close(luminance([255, 255, 255]), 1, 1e-9);
    close(contrastRatio([0, 0, 0], [255, 255, 255]), 21, 1e-6);
    close(contrastRatio([119, 119, 119], [255, 255, 255]), 4.48, 0.02);
    close(contrastRatio([255, 255, 255], [255, 255, 255]), 1, 1e-9);
  });
  it("applies opacity to the foreground and layers to the background", () => {
    const pair = resolvePair("rgb(0, 0, 0)", 0.5, [{ color: "rgb(255, 255, 255)", opacity: 1 }]);
    close(pair.ratio, contrastRatio([127.5, 127.5, 127.5], [255, 255, 255]), 1e-6);
  });
  it("takes the worst stop of a gradient layer", () => {
    const pair = resolvePair("rgb(0, 0, 0)", 1, [
      { stops: ["rgb(255, 255, 255)", "rgb(20, 20, 20)"], opacity: 1 },
    ]);
    assert.ok(pair.ratio < 2);
  });
  it("returns null for a colour it cannot parse", () => {
    assert.equal(resolvePair("lab(1 2 3)", 1, []), null);
  });
  it("treats 24px, or 18.66px at weight 700, as large", () => {
    assert.equal(isLarge(24, 400), true);
    assert.equal(isLarge(18.66, 700), true);
    assert.equal(isLarge(18.66, 400), false);
    assert.equal(isLarge(16, 700), false);
  });
});

describe("target minimums", () => {
  it("uses 44 on phones and 24 on a desktop pointer", () => {
    assert.equal(minTarget(390), 44);
    assert.equal(minTarget(767), 44);
    assert.equal(minTarget(768), 24);
    assert.equal(minTarget(1440), 24);
  });
  it("flags a box short on either side", () => {
    assert.equal(targetShort({ width: 44, height: 44 }, 390), null);
    assert.equal(targetShort({ width: 125, height: 28 }, 390), 44);
    assert.equal(targetShort({ width: 24, height: 24 }, 1440), null);
    assert.equal(targetShort({ width: 80, height: 15 }, 1440), 24);
  });
});

describe("findingsFor", () => {
  const base = { text: [], targets: [], clips: [], scrollWidth: 390, clientWidth: 390 };
  it("reports a low-contrast text node once per colour pair", () => {
    const t = {
      el: "span.sep",
      sample: "x",
      fg: "rgb(150, 150, 150)",
      fgOpacity: 1,
      layers: [{ color: "rgb(255, 255, 255)", opacity: 1 }],
      size: 14,
      weight: 400,
      approx: false,
    };
    const f = findingsFor("/", 390, "light", { ...base, text: [t, t] });
    assert.equal(f.length, 1);
    assert.equal(f[0].kind, "contrast");
    assert.equal(f[0].count, 2);
  });
  it("skips exempt targets and reports short ones and horizontal scroll", () => {
    const targets = [
      { el: "a", label: "in text", width: 20, height: 10, exempt: true },
      { el: "a.credit", label: "Kalebtec", width: 60, height: 15, exempt: false },
    ];
    const f = findingsFor("/", 1440, "dark", {
      ...base,
      targets,
      scrollWidth: 1500,
      clientWidth: 1440,
    });
    assert.deepEqual(f.map((x) => x.kind).sort(), ["h-scroll", "target"]);
  });
});
