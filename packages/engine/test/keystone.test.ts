// Calibration → execution reproducibility keystone.
//
// The architectural bet: after calibration produces a doc pack, a deterministic `run` on a fresh process
// (no agent context, no LLM) reproduces it. Here we run a fixture flow against a local toy site twice and
// assert the structured artifacts are byte-identical and the screenshots are present.
//
// Needs a Chromium binary. `playwright-core` ships the API, not the binary — install one with
// `pnpm -C packages/engine exec playwright-core install chromium` (or `npx playwright install chromium`).
// Without it this suite skips (so CI without a browser stays green); install it to actually exercise the keystone.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { runFlow } from "../src/flow-runtime.js";
import { launchPlaywrightSession } from "../src/playwright-driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const toySiteUrl = pathToFileURL(path.join(fixturesDir, "toy-site")).href + "/";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

async function calibratedRun(outDir: string) {
  const flow = parseFlowFile(
    await fs.readFile(path.join(fixturesDir, "recap-open.flow.yaml"), "utf8"),
  );
  await fs.mkdir(outDir, { recursive: true });
  const session = await launchPlaywrightSession({ baseURL: toySiteUrl, docPackRoot: outDir });
  try {
    return await runFlow(flow, session.driver);
  } finally {
    await session.close();
  }
}

describe.skipIf(!chromiumAvailable)("keystone — calibrate → run → reproduce", () => {
  it("runs the fixture flow against the toy site and emits the expected doc-pack artifacts", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-keystone-"));
    try {
      const r = await calibratedRun(path.join(tmp, "run1"));
      expect(r.flow).toBe("recap-open");
      expect(r.steps.map((s) => s.id)).toEqual(["open-app", "open-sidebar"]);
      expect(r.annotations.flow).toBe("recap-open");
      expect(r.annotations.annotations).toHaveLength(1);
      const ann = r.annotations.annotations[0]!;
      expect(ann.step).toBe("open-sidebar");
      expect(ann.selector).toBe("#play-recap");
      expect(ann.copy).toBe("Click Play to open the Recap sidebar");
      expect(ann.arrow_style).toBe("top-right");
      expect(ann.bounding_box).toBeTruthy();
      expect(ann.bounding_box!.width).toBeGreaterThan(0);

      const shot = path.join(tmp, "run1", "docs", "recap-open", "screenshots", "open-sidebar.png");
      const stat = await fs.stat(shot);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("is reproducible — two independent runs produce identical structured artifacts", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-keystone-"));
    try {
      const a = await calibratedRun(path.join(tmp, "run1"));
      const b = await calibratedRun(path.join(tmp, "run2"));
      // No timestamps in our annotations — they should be exactly equal.
      expect(b.annotations).toEqual(a.annotations);
      expect(b.steps).toEqual(a.steps);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

async function redactedClockRun(outDir: string) {
  const flow = parseFlowFile(
    await fs.readFile(path.join(fixturesDir, "redacted-clock.flow.yaml"), "utf8"),
  );
  await fs.mkdir(outDir, { recursive: true });
  const session = await launchPlaywrightSession({
    baseURL: toySiteUrl,
    docPackRoot: outDir,
    environment: flow.environment,
  });
  try {
    return await runFlow(flow, session.driver);
  } finally {
    await session.close();
  }
}

describe.skipIf(!chromiumAvailable)("keystone — frozen clock + redaction determinism", () => {
  it("masks the secret element with uniform black while a control region stays untouched", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-keystone-"));
    try {
      // The flow's own success criterion asserts the rendered clock shows the frozen instant —
      // a non-frozen clock halts the run before any screenshot assertion happens.
      await redactedClockRun(path.join(tmp, "run1"));
      const shot = path.join(
        tmp,
        "run1",
        "docs",
        "redacted-clock",
        "screenshots",
        "open-account.png",
      );
      const img = PNG.sync.read(await fs.readFile(shot));
      const px = (x: number, y: number) => {
        const i = (y * img.width + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
      };
      // #secret occupies CSS (100,100)–(300,140); dpr=1 headless → device px 1:1. Interior
      // must be uniformly black (the solid `box` fill).
      for (let y = 102; y < 138; y += 6) {
        for (let x = 102; x < 298; x += 14) {
          expect(px(x, y)).toEqual([0, 0, 0, 255]);
        }
      }
      // #control at CSS (400,100)–(520,140) is NOT redacted — its corner keeps the page colour.
      expect(px(402, 102)).not.toEqual([0, 0, 0, 255]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("is byte-identical across two independent runs — the headline determinism claim", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-keystone-"));
    try {
      const a = await redactedClockRun(path.join(tmp, "run1"));
      const b = await redactedClockRun(path.join(tmp, "run2"));
      expect(b.annotations).toEqual(a.annotations);
      const rel = path.join("docs", "redacted-clock", "screenshots", "open-account.png");
      const shotA = await fs.readFile(path.join(tmp, "run1", rel));
      const shotB = await fs.readFile(path.join(tmp, "run2", rel));
      expect(shotA.equals(shotB)).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("keystone — availability note", () => {
  it(
    chromiumAvailable
      ? "Chromium is available — keystone suite ran"
      : "Chromium not installed — keystone suite skipped (see file header)",
    () => {
      expect(typeof chromiumAvailable).toBe("boolean");
    },
  );
});
