// Drift detection — pixel diff exactness (tolerated regions, dimension changes), the
// step/annotation/locator/prose diff matrix, the markdown golden, CLI exit codes, and
// determinism. Pure file → JSON transform, so this is a unit suite (no browser, no HTTP).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  diffDocPacks,
  diffPngBuffers,
  formatDriftReportMarkdown,
  severityAtLeast,
} from "../src/diff.js";
import { main } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Synthetic PNG helpers
// ---------------------------------------------------------------------------

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

/** Copy of `base` with the pixels in `rect` repainted to `rgba`. */
function withRect(
  base: Buffer,
  rect: { x: number; y: number; width: number; height: number },
  rgba: [number, number, number, number],
): Buffer {
  const png = PNG.sync.read(base);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const RED: [number, number, number, number] = [200, 0, 0, 255];

describe("diffPngBuffers", () => {
  it("identical images: zero changed pixels, no region", () => {
    const a = solidPng(10, 10, WHITE);
    expect(diffPngBuffers(a, solidPng(10, 10, WHITE))).toEqual({
      kind: "pixels",
      changed_pixel_count: 0,
      pct: 0,
      region: null,
    });
  });

  it("counts exact changed pixels and reports the changed-region bbox", () => {
    const a = solidPng(10, 10, WHITE);
    const b = withRect(a, { x: 2, y: 3, width: 5, height: 1 }, RED);
    expect(diffPngBuffers(a, b)).toEqual({
      kind: "pixels",
      changed_pixel_count: 5,
      pct: 5,
      region: { x: 2, y: 3, width: 5, height: 1 },
    });
  });

  it("ignore regions exclude pixels from the diff", () => {
    const a = solidPng(10, 10, WHITE);
    const b = withRect(a, { x: 2, y: 3, width: 5, height: 1 }, RED);
    const ignored = diffPngBuffers(a, b, [{ x: 2, y: 3, width: 5, height: 1 }]);
    expect(ignored).toEqual({ kind: "pixels", changed_pixel_count: 0, pct: 0, region: null });
    // A partial ignore region leaves the uncovered pixels counted.
    const partial = diffPngBuffers(a, b, [{ x: 2, y: 3, width: 3, height: 1 }]);
    expect(partial).toEqual({
      kind: "pixels",
      changed_pixel_count: 2,
      pct: 2,
      region: { x: 5, y: 3, width: 2, height: 1 },
    });
  });

  it("flags dimension changes distinctly (no pixel comparison)", () => {
    expect(diffPngBuffers(solidPng(10, 10, WHITE), solidPng(12, 8, WHITE))).toEqual({
      kind: "dimension-change",
      a: { width: 10, height: 10 },
      b: { width: 12, height: 8 },
    });
  });
});

describe("severityAtLeast", () => {
  it("ranks none < info < warn < fail", () => {
    expect(severityAtLeast("warn", "warn")).toBe(true);
    expect(severityAtLeast("fail", "warn")).toBe(true);
    expect(severityAtLeast("info", "warn")).toBe(false);
    expect(severityAtLeast("none", "fail")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Doc-pack fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const BASE_FLOW = `name: checkout
locators:
  pay: "[data-testid=pay]"
  cart: "[data-testid=cart]"
steps:
  - id: open
    action: navigate
    value: /checkout
    wait_for: network_idle
  - id: pay
    action: click
    target: $pay
    success: { visible: $cart }
    annotation: { copy: Click pay. }
`;

interface PackFiles {
  flow?: string;
  annotations?: object;
  screenshots?: Record<string, Buffer>;
  prose?: Record<string, string>;
}

async function makePack(files: PackFiles): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-drift-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "flows"), { recursive: true });
  await fs.mkdir(path.join(dir, "docs", "checkout", "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "flows", "checkout.flow.yaml"),
    files.flow ?? BASE_FLOW,
    "utf8",
  );
  if (files.annotations) {
    await fs.writeFile(
      path.join(dir, "docs", "checkout", "annotations.json"),
      JSON.stringify(files.annotations, null, 2),
      "utf8",
    );
  }
  for (const [name, buf] of Object.entries(files.screenshots ?? {})) {
    await fs.writeFile(path.join(dir, "docs", "checkout", "screenshots", name), buf);
  }
  for (const [name, text] of Object.entries(files.prose ?? {})) {
    await fs.writeFile(path.join(dir, "docs", "checkout", name), text, "utf8");
  }
  return dir;
}

function annotationsFile(boxes: Array<{ step: string; x: number; y: number }>): object {
  return {
    schema: "docsxai/annotations@1",
    flow: "checkout",
    annotations: boxes.map((b) => ({
      step: b.step,
      selector: "[data-testid=pay]",
      bounding_box: { x: b.x, y: b.y, width: 100, height: 30 },
      copy: "Click pay.",
    })),
  };
}

describe("diffDocPacks", () => {
  it("identical packs: no drift, severity none", async () => {
    const shot = solidPng(10, 10, WHITE);
    const a = await makePack({ screenshots: { "pay.png": shot }, prose: { "pay.md": "Pay.\n" } });
    const b = await makePack({ screenshots: { "pay.png": shot }, prose: { "pay.md": "Pay.\n" } });
    const report = await diffDocPacks(a, b);
    expect(report.schema).toBe("docsxai/drift@1");
    expect(report.flows).toEqual([]);
    expect(report.summary).toEqual({
      flows_changed: 0,
      steps_changed: 0,
      screenshots_changed: 0,
      max_pixel_change_pct: 0,
      severity: "none",
    });
  });

  it("step add/remove/field-change matrix (id-keyed deltas)", async () => {
    const a = await makePack({});
    const b = await makePack({
      flow: `name: checkout
locators:
  pay: "[data-testid=pay]"
  cart: "[data-testid=cart]"
steps:
  - id: pay
    action: click
    target: $cart
    optional: true
    wait_for: { timeout_ms: 500 }
    success: { hidden: $cart }
    annotation: { copy: Click pay now. }
  - id: confirm
    action: click
    target: $pay
`,
    });
    const report = await diffDocPacks(a, b);
    expect(report.flows).toHaveLength(1);
    const flow = report.flows[0]!;
    expect(flow.flow).toBe("checkout");
    expect(flow.steps_added).toEqual(["confirm"]);
    expect(flow.steps_removed).toEqual(["open"]);
    expect(flow.steps_changed).toEqual([
      {
        id: "pay",
        fields: [
          { field: "optional", a: null, b: true },
          { field: "target", a: "$pay", b: "$cart" },
          { field: "wait_for", a: null, b: { timeout_ms: 500 } },
          { field: "success", a: { visible: "$cart" }, b: { hidden: "$cart" } },
          { field: "annotation", a: { copy: "Click pay." }, b: { copy: "Click pay now." } },
        ],
      },
    ]);
    expect(flow.severity).toBe("warn");
    expect(report.summary.steps_changed).toBe(3);
  });

  it("locator added / removed / changed", async () => {
    const a = await makePack({});
    const b = await makePack({
      flow: BASE_FLOW.replace('cart: "[data-testid=cart]"', 'cart: "[data-testid=basket]"').replace(
        "locators:",
        'locators:\n  promo: "[data-testid=promo]"',
      ),
    });
    const report = await diffDocPacks(a, b);
    const flow = report.flows[0]!;
    expect(flow.locators_added).toEqual(["promo"]);
    expect(flow.locators_removed).toEqual([]);
    expect(flow.locators_changed).toEqual([
      { name: "cart", a: "[data-testid=cart]", b: "[data-testid=basket]" },
    ]);
  });

  it("annotation moves beyond tolerance are reported; within tolerance are not", async () => {
    const a = await makePack({ annotations: annotationsFile([{ step: "pay", x: 10, y: 20 }]) });
    const moved = await makePack({
      annotations: annotationsFile([{ step: "pay", x: 24, y: 20 }]),
    });
    const nudged = await makePack({
      annotations: annotationsFile([{ step: "pay", x: 11, y: 21 }]),
    });

    const movedReport = await diffDocPacks(a, moved);
    expect(movedReport.flows[0]!.annotations_moved).toEqual([
      {
        step: "pay",
        copy: "Click pay.",
        a: { x: 10, y: 20, width: 100, height: 30 },
        b: { x: 24, y: 20, width: 100, height: 30 },
        delta_px: 14,
      },
    ]);

    const nudgedReport = await diffDocPacks(a, nudged); // Δ 1px ≤ default tolerance 2
    expect(nudgedReport.flows).toEqual([]);
  });

  it("screenshot severity follows the pct policy (info < warn < fail)", async () => {
    const base = solidPng(20, 10, WHITE); // 200 px
    const a = await makePack({
      screenshots: {
        "open.png": base,
        "pay.png": base,
        "confirm.png": base,
      },
    });
    const b = await makePack({
      screenshots: {
        "open.png": withRect(base, { x: 0, y: 0, width: 1, height: 1 }, RED), // 0.5% → info
        "pay.png": withRect(base, { x: 0, y: 0, width: 3, height: 1 }, RED), // 1.5% → warn
        "confirm.png": withRect(base, { x: 0, y: 0, width: 11, height: 1 }, RED), // 5.5% → fail
      },
    });
    const report = await diffDocPacks(a, b);
    const shots = report.flows[0]!.screenshots;
    expect(shots).toEqual([
      {
        step: "confirm",
        status: "changed",
        changed_pixel_count: 11,
        pct: 5.5,
        region: { x: 0, y: 0, width: 11, height: 1 },
        severity: "fail",
      },
      {
        step: "open",
        status: "changed",
        changed_pixel_count: 1,
        pct: 0.5,
        region: { x: 0, y: 0, width: 1, height: 1 },
        severity: "info",
      },
      {
        step: "pay",
        status: "changed",
        changed_pixel_count: 3,
        pct: 1.5,
        region: { x: 0, y: 0, width: 3, height: 1 },
        severity: "warn",
      },
    ]);
    expect(report.summary.severity).toBe("fail");
    expect(report.summary.max_pixel_change_pct).toBe(5.5);
    expect(report.summary.screenshots_changed).toBe(3);
  });

  it("ignore_regions exclude a named flow/step rectangle from the pixel diff", async () => {
    const base = solidPng(20, 10, WHITE);
    const a = await makePack({ screenshots: { "pay.png": base } });
    const b = await makePack({
      screenshots: { "pay.png": withRect(base, { x: 5, y: 5, width: 4, height: 2 }, RED) },
    });
    const report = await diffDocPacks(a, b, {
      ignore_regions: [
        { flow: "checkout", step: "pay", region: { x: 5, y: 5, width: 4, height: 2 } },
      ],
    });
    expect(report.flows).toEqual([]);
    // The same region on a DIFFERENT step does not mask the change.
    const other = await diffDocPacks(a, b, {
      ignore_regions: [
        { flow: "checkout", step: "open", region: { x: 5, y: 5, width: 4, height: 2 } },
      ],
    });
    expect(other.flows[0]!.screenshots[0]!.changed_pixel_count).toBe(8);
  });

  it("screenshot dimension changes are flagged distinctly and fail", async () => {
    const a = await makePack({ screenshots: { "pay.png": solidPng(10, 10, WHITE) } });
    const b = await makePack({ screenshots: { "pay.png": solidPng(12, 8, WHITE) } });
    const report = await diffDocPacks(a, b);
    expect(report.flows[0]!.screenshots).toEqual([
      {
        step: "pay",
        status: "changed",
        dimension_change: { a: { width: 10, height: 10 }, b: { width: 12, height: 8 } },
        severity: "fail",
      },
    ]);
    expect(report.summary.max_pixel_change_pct).toBe(0); // dimension change has no pct
  });

  it("screenshot added / removed are warn-level", async () => {
    const a = await makePack({ screenshots: { "pay.png": solidPng(4, 4, WHITE) } });
    const b = await makePack({ screenshots: { "open.png": solidPng(4, 4, WHITE) } });
    const report = await diffDocPacks(a, b);
    expect(report.flows[0]!.screenshots).toEqual([
      { step: "open", status: "added", severity: "warn" },
      { step: "pay", status: "removed", severity: "warn" },
    ]);
  });

  it("prose line-change counts (LCS-based)", async () => {
    const a = await makePack({ prose: { "pay.md": "One.\nTwo.\nThree.\n" } });
    const b = await makePack({
      prose: { "pay.md": "One.\nTwo updated.\nThree.\nFour.\n", "open.md": "New page.\n" },
    });
    const report = await diffDocPacks(a, b);
    expect(report.flows[0]!.prose).toEqual([
      { step: "open", status: "added", lines_added: 2, lines_removed: 0 },
      { step: "pay", status: "changed", lines_added: 2, lines_removed: 1 },
    ]);
  });

  it("whole-flow add/remove is reported as flow status", async () => {
    const a = await makePack({});
    const b = await makePack({});
    await fs.writeFile(
      path.join(b, "flows", "settings.flow.yaml"),
      "name: settings\nsteps:\n  - id: s1\n    action: navigate\n    value: /settings\n",
      "utf8",
    );
    await fs.rm(path.join(b, "flows", "checkout.flow.yaml"));
    const report = await diffDocPacks(a, b);
    expect(report.flows.map((f) => [f.flow, f.status, f.severity])).toEqual([
      ["checkout", "removed", "warn"],
      ["settings", "added", "warn"],
    ]);
  });

  it("reports are deterministic (byte-identical across runs, no timestamps)", async () => {
    const base = solidPng(20, 10, WHITE);
    const a = await makePack({
      annotations: annotationsFile([{ step: "pay", x: 10, y: 20 }]),
      screenshots: { "pay.png": base },
      prose: { "pay.md": "One.\n" },
    });
    const b = await makePack({
      flow: BASE_FLOW.replace("$pay", "$cart"),
      annotations: annotationsFile([{ step: "pay", x: 40, y: 20 }]),
      screenshots: { "pay.png": withRect(base, { x: 1, y: 1, width: 6, height: 2 }, RED) },
      prose: { "pay.md": "One.\nTwo.\n" },
    });
    const first = JSON.stringify(await diffDocPacks(a, b));
    const second = JSON.stringify(await diffDocPacks(a, b));
    expect(first).toBe(second);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamps anywhere
  });
});

describe("formatDriftReportMarkdown", () => {
  it("renders the PR-comment golden", async () => {
    const base = solidPng(20, 10, WHITE);
    const a = await makePack({
      annotations: annotationsFile([{ step: "pay", x: 10, y: 20 }]),
      screenshots: { "pay.png": base },
      prose: { "pay.md": "One.\nTwo.\n" },
    });
    const b = await makePack({
      flow: BASE_FLOW.replace('pay: "[data-testid=pay]"', 'pay: "[data-testid=pay-now]"'),
      annotations: annotationsFile([{ step: "pay", x: 40, y: 20 }]),
      screenshots: { "pay.png": withRect(base, { x: 2, y: 4, width: 11, height: 1 }, RED) },
      prose: { "pay.md": "One.\nTwo updated.\n" },
    });
    const report = await diffDocPacks(a, b);
    expect(formatDriftReportMarkdown(report)).toBe(
      `# docsxai drift report

\`${a}\` → \`${b}\`

| Flow | Severity | Steps Δ | Annotations | Screenshots Δ | Locators Δ | Prose Δ |
| --- | --- | --- | --- | --- | --- | --- |
| \`checkout\` | [FAIL] | +0 / -0 / ~0 | 1 moved | 1 | 1 | 1 |

## \`checkout\` [FAIL]

- annotation moved on \`pay\` (Δ 30px): (10,20 100×30) → (40,20 100×30)
- screenshot \`pay.png\` [FAIL]: 11 px (5.5%) changed in region (x 2, y 4, 11×1)
- locator \`pay\` changed: \`[data-testid=pay]\` → \`[data-testid=pay-now]\`
- prose \`pay.md\`: +1 / -1 lines

**Totals:** 1 flow changed · 0 steps · 1 screenshot · max pixel change 5.5% · severity fail
`,
    );
  });
});

// ---------------------------------------------------------------------------
// CLI: baseline + diff
// ---------------------------------------------------------------------------

describe("baseline + diff CLI", () => {
  let out = "";
  let err = "";

  beforeEach(() => {
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("baseline snapshots into <ws>/.baseline/ and diff reads it by default", async () => {
    const ws = await makePack({
      screenshots: { "pay.png": solidPng(10, 10, WHITE) },
      prose: { "pay.md": "Pay.\n" },
    });
    expect(await main(["baseline", ws])).toBe(0);
    expect(out).toMatch(/baseline: snapshotted 3 files/);
    await fs.access(path.join(ws, ".baseline", "flows", "checkout.flow.yaml"));
    await fs.access(path.join(ws, ".baseline", "docs", "checkout", "screenshots", "pay.png"));
    await fs.access(path.join(ws, ".baseline", "docs", "checkout", "pay.md"));

    out = "";
    expect(await main(["diff", ws])).toBe(0);
    expect(out).toMatch(/no drift detected/);
  });

  it("diff exits per --fail-on threshold; json format is machine-readable", async () => {
    const ws = await makePack({});
    expect(await main(["baseline", ws])).toBe(0);
    // Structural drift (a step edit) is warn-level.
    await fs.writeFile(
      path.join(ws, "flows", "checkout.flow.yaml"),
      BASE_FLOW.replace("$pay", "$cart"),
      "utf8",
    );

    expect(await main(["diff", ws])).toBe(0); // no --fail-on → report-only
    expect(await main(["diff", ws, "--fail-on", "warn"])).toBe(1);
    expect(await main(["diff", ws, "--fail-on", "fail"])).toBe(0);

    out = "";
    expect(await main(["diff", ws, "--format", "json"])).toBe(0);
    const report = JSON.parse(out) as {
      schema: string;
      summary: { severity: string; steps_changed: number };
    };
    expect(report.schema).toBe("docsxai/drift@1");
    expect(report.summary.severity).toBe("warn");
    expect(report.summary.steps_changed).toBe(1);

    out = "";
    expect(await main(["diff", ws, "--format", "md"])).toBe(0);
    expect(out).toMatch(/^# docsxai drift report/);
  });

  it("diff without a baseline exits 2 with a hint; bad flags exit 2", async () => {
    const ws = await makePack({});
    expect(await main(["diff", ws])).toBe(2);
    expect(err).toMatch(/run `docsxai baseline/);
    expect(await main(["diff", ws, "--format", "yaml"])).toBe(2);
    expect(await main(["diff", ws, "--fail-on", "info"])).toBe(2);
    expect(await main(["diff"])).toBe(2);
    expect(await main(["baseline"])).toBe(2);
  });

  it("baseline --out and diff --against pair up; re-baselining replaces stale files", async () => {
    const ws = await makePack({ prose: { "pay.md": "Pay.\n" } });
    const outDir = path.join(ws, ".snapshots", "v1");
    expect(await main(["baseline", ws, "--out", outDir])).toBe(0);
    expect(await main(["diff", ws, "--against", outDir])).toBe(0);
    expect(out).toMatch(/no drift detected/);

    // Drop the prose file and re-baseline into the same dir: the stale copy must not survive.
    await fs.rm(path.join(ws, "docs", "checkout", "pay.md"));
    expect(await main(["baseline", ws, "--out", outDir])).toBe(0);
    out = "";
    expect(await main(["diff", ws, "--against", outDir])).toBe(0);
    expect(out).toMatch(/no drift detected/);
  });
});
