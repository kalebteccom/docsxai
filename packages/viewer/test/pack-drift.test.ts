import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPack, type BuiltPack } from "../src/pack-build.js";
import { computeDrift, readCommittedPack } from "../src/pack-drift.js";
import { createOxipngOptimiser, identityOptimiser, type Optimiser } from "../src/pack-optimise.js";
import { readRawCapture } from "../src/pack-source.js";
import { MAX_PNG_BYTES } from "../src/safe-read.js";
import { writePack } from "../src/pack-write.js";
import { writeOxipngShim, writeRawCapture, type RawFlowSpec } from "./helpers/pack-fixtures.js";
import { layeredPng, solidPng } from "./helpers/png.js";

const SIZE = 20;
const white = () => layeredPng(SIZE, SIZE, 255);
const block = (x: number, y: number, w: number, h: number) =>
  layeredPng(SIZE, SIZE, 255, [{ x, y, width: w, height: h, grey: 0 }]);

let root = "";
let committed = "";
let counter = 0;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-drift-"));
  committed = path.join(root, "committed");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

interface Capture {
  /** The `tour/home` screenshot; `null` leaves the step out. */
  home?: Buffer | null;
  /** Adds a `tour/settings` step (dark, 390). */
  settings?: boolean;
  /** The settings screenshot when it differs from the default. */
  settingsPng?: Buffer;
}

function spec(c: Capture): Record<string, RawFlowSpec> {
  const steps: RawFlowSpec["steps"] = {};
  if (c.home !== null) {
    steps.home = {
      alt: { en: "Home" },
      variants: { "en.light.390": { png: c.home ?? white() } },
    };
  }
  if (c.settings) {
    steps.settings = {
      alt: { en: "Settings" },
      variants: { "en.dark.390": { png: c.settingsPng ?? layeredPng(SIZE, SIZE, 10) } },
    };
  }
  return { tour: { steps } };
}

async function build(c: Capture, optimise: Optimiser = identityOptimiser): Promise<BuiltPack> {
  const dir = path.join(root, `raw-${counter++}`);
  await writeRawCapture(dir, spec(c));
  return buildPack({
    source: await readRawCapture(dir),
    optimise,
    warn: () => {},
  });
}

async function commit(c: Capture, optimise?: Optimiser): Promise<BuiltPack> {
  const built = await build(c, optimise);
  await writePack({ outDir: committed, files: built.files, manifestText: built.manifestText });
  return built;
}

const drift = async (c: Capture, thresholdPct?: number) =>
  computeDrift({
    fresh: await build(c),
    against: committed,
    ...(thresholdPct !== undefined ? { thresholdPct } : {}),
  });

describe("computeDrift", () => {
  it("reports no drift for the same capture", async () => {
    await commit({});
    const report = await drift({});
    expect(report).toMatchObject({ compared: 1, failing: 0, thresholdPct: 0.5, entries: [] });
    expect(report.text).toBe("docsxai drift: 1 compared, 0 over threshold (0.5%)");
  });

  it("lists a change under the threshold and passes", async () => {
    await commit({});
    const report = await drift({ home: block(10, 10, 1, 1) });
    expect(report.failing).toBe(0);
    expect(report.entries).toEqual([
      {
        id: "tour/home/en.light.390",
        status: "changed",
        failing: false,
        pct: 0.25,
        region: { x: 10, y: 10, width: 1, height: 1 },
      },
    ]);
    expect(report.text).toBe(
      [
        "docsxai drift: 1 compared, 0 over threshold (0.5%)",
        "  changed  tour/home/en.light.390  0.25%  region 10,10 1x1",
      ].join("\n"),
    );
  });

  it("fails past the threshold, names the region and flags the line OVER", async () => {
    await commit({});
    const report = await drift({ home: block(5, 6, 4, 4) });
    expect(report.failing).toBe(1);
    expect(report.text).toContain("1 compared, 1 over threshold (0.5%)");
    expect(report.text).toContain("  changed  tour/home/en.light.390  4%  region 5,6 4x4  OVER");
  });

  it("takes the threshold from the caller, and only fails when the change is above it", async () => {
    await commit({});
    const changed = { home: block(5, 6, 4, 4) };
    expect((await drift(changed, 5)).failing).toBe(0);
    expect((await drift(changed, 4)).failing).toBe(0);
    expect((await drift(changed, 3.9999)).failing).toBe(1);
    expect((await drift(changed, 0)).failing).toBe(1);
    expect((await drift(changed, 5)).text).toContain("(5%)");
  });

  it("fails a new variant and a missing one, listed by id", async () => {
    await commit({});
    const report = await drift({ home: null, settings: true });
    expect(report).toMatchObject({ compared: 0, failing: 2 });
    expect(report.entries.map((e) => [e.id, e.status])).toEqual([
      ["tour/home/en.light.390", "missing"],
      ["tour/settings/en.dark.390", "new"],
    ]);
    expect(report.text).toMatch(/\n {2}missing {2}tour\/home\/en\.light\.390\n/);
    expect(report.text).toMatch(/\n {2}new {6}tour\/settings\/en\.dark\.390$/);
  });

  it("fails a resized capture with both sizes", async () => {
    await commit({});
    const report = await drift({ home: solidPng(SIZE + 2, SIZE, [255, 255, 255, 255]) });
    expect(report.failing).toBe(1);
    expect(report.entries[0]).toMatchObject({
      status: "resized",
      failing: true,
      from: { width: 20, height: 20 },
      to: { width: 22, height: 20 },
    });
    expect(report.text).toContain("  resized  tour/home/en.light.390  20x20 -> 22x20");
  });

  it("does not list a variant that is unchanged, but counts it as compared", async () => {
    await commit({ settings: true });
    const report = await drift({ home: block(5, 6, 4, 4), settings: true });
    expect(report.compared).toBe(2);
    expect(report.entries.map((e) => e.id)).toEqual(["tour/home/en.light.390"]);
  });

  it("sorts entries by id", async () => {
    await commit({ settings: true });
    const report = await drift({
      home: block(1, 1, 2, 2),
      settings: true,
      settingsPng: layeredPng(SIZE, SIZE, 10, [{ x: 0, y: 0, width: 3, height: 3, grey: 200 }]),
    });
    expect(report.entries.map((e) => e.id)).toEqual([
      "tour/home/en.light.390",
      "tour/settings/en.dark.390",
    ]);
  });

  it("passes a rebuild whose pixels match but whose bytes differ (the optimiser)", async () => {
    const shim = await writeOxipngShim(root);
    const optimise = await createOxipngOptimiser(shim.command);
    await commit({}, optimise);
    const fresh = await build({});
    const committedPack = await readCommittedPack(committed);
    // The committed file is named after the optimised bytes, the rebuild's after the plain ones.
    expect(committedPack.flows.tour!.steps.home!.variants["en.light.390"]!.src).not.toBe(
      fresh.pack.flows.tour!.steps.home!.variants["en.light.390"]!.src,
    );
    const report = await computeDrift({ fresh, against: committed });
    expect(report).toMatchObject({ compared: 1, failing: 0, entries: [] });
  });

  it("fails a committed file that is missing, or whose bytes do not match its name", async () => {
    const built = await commit({});
    const [relative] = [...built.files.keys()];
    const file = path.join(committed, relative!);

    await fs.writeFile(file, block(2, 2, 2, 2));
    let report = await drift({});
    expect(report.entries).toEqual([
      {
        id: "tour/home/en.light.390",
        status: "broken",
        failing: true,
        detail: `${relative} does not match its hash`,
      },
    ]);
    expect(report.text).toContain(
      `  broken   tour/home/en.light.390  ${relative} does not match its hash`,
    );

    await fs.rm(file);
    report = await drift({});
    expect(report.entries[0]).toMatchObject({
      status: "broken",
      detail: `${relative} is not on disk`,
    });
    expect(report.failing).toBe(1);
  });

  it("fails a committed PNG that is a symlink, even when it points at the right bytes", async () => {
    const built = await commit({});
    const [relative] = [...built.files.keys()];
    const file = path.join(committed, relative!);
    const elsewhere = path.join(root, "elsewhere.png");
    await fs.rename(file, elsewhere);
    await fs.symlink(elsewhere, file);
    const report = await drift({});
    expect(report.failing).toBe(1);
    expect(report.entries).toEqual([
      {
        id: "tour/home/en.light.390",
        status: "broken",
        failing: true,
        detail: `${relative} is a symlink`,
      },
    ]);
  });

  it("fails a committed PNG above the 64 MiB cap without reading it", async () => {
    expect(MAX_PNG_BYTES).toBe(64 * 1024 * 1024);
    const built = await commit({});
    const [relative] = [...built.files.keys()];
    await fs.truncate(path.join(committed, relative!), MAX_PNG_BYTES + 1);
    const report = await drift({});
    expect(report.entries[0]).toMatchObject({
      status: "broken",
      failing: true,
      detail: `${relative} is larger than 64 MiB`,
    });
  });

  it("prints the same report for the same two packs", async () => {
    await commit({});
    const a = await drift({ home: block(5, 6, 4, 4) });
    const b = await drift({ home: block(5, 6, 4, 4) });
    expect(b.text).toBe(a.text);
    expect(a.text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("readCommittedPack", () => {
  it("returns the committed pack", async () => {
    const built = await commit({});
    expect(await readCommittedPack(committed)).toEqual(built.pack);
  });

  it("fails with a clear message when there is no manifest, it is not JSON or it is invalid", async () => {
    await fs.mkdir(committed, { recursive: true });
    await expect(readCommittedPack(committed)).rejects.toThrow(/no manifest\.json in /);

    await fs.writeFile(path.join(committed, "manifest.json"), "not json");
    await expect(readCommittedPack(committed)).rejects.toThrow(/manifest\.json: /);

    const built = await build({});
    const broken = structuredClone(built.pack);
    broken.flows.tour!.steps.home!.variants["en.light.390"]!.width = 0;
    await fs.writeFile(path.join(committed, "manifest.json"), JSON.stringify(broken));
    const error = await readCommittedPack(committed).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/is not a valid pack:\n {2}- .*width/);
    expect((error as Error).message).not.toContain("Only docsxai/screens-pack@2");
  });

  it("does not quote the file when the manifest is not JSON", async () => {
    await fs.mkdir(committed, { recursive: true });
    await fs.writeFile(path.join(committed, "manifest.json"), '{"token": "sk-live-hunter2" oops');
    const error = await readCommittedPack(committed).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/manifest\.json: not valid JSON$/);
    expect((error as Error).message).not.toContain("hunter2");
  });

  it("refuses a manifest that is a symlink", async () => {
    await commit({});
    const manifest = path.join(committed, "manifest.json");
    const elsewhere = path.join(root, "elsewhere.json");
    await fs.rename(manifest, elsewhere);
    await fs.symlink(elsewhere, manifest);
    await expect(readCommittedPack(committed)).rejects.toThrow(/manifest\.json is a symlink/);
  });

  it("says only v2 can be compared when the committed manifest is an older shape", async () => {
    await fs.mkdir(committed, { recursive: true });
    await fs.writeFile(
      path.join(committed, "manifest.json"),
      JSON.stringify({ schema: "docsxai/screens-pack@1", screens: {} }),
    );
    await expect(readCommittedPack(committed)).rejects.toThrow(
      /Only docsxai\/screens-pack@2 can be compared; rebuild the committed pack with `docsxai pack`/,
    );
  });
});
