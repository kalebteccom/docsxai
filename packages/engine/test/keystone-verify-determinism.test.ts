// Keystone for `docsxai run --verify-determinism`: real Chromium, the real runtime and the real CLI,
// against a loopback page that either serves the same stamp on every request (the control) or a
// stamp that moves on every request (the injected nondeterminism).
//
// Claims: on the deterministic page every run writes the same bytes, the command exits 0 and run 1's
// output lands in the workspace; on the injected page it exits 1, names the one artefact that
// differs (the stamp screenshot, with the changed-pixel region inside the stamp's box), leaves the
// workspace without any doc-pack output, and removes its run roots.
//
// Needs Chromium (see keystone.test.ts); skips without it.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { formatVerifyReportText, type VerifyReport } from "../src/verify-report.js";
import { serveVerifyPage, type VerifyPageMode } from "./fixtures/verify-server.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

describe.skipIf(!chromiumAvailable)("keystone — run --verify-determinism", () => {
  let ws = "";
  let out = "";
  let err = "";

  beforeEach(async () => {
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
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-verify-"));
    await fs.mkdir(path.join(ws, "flows"), { recursive: true });
    await fs.copyFile(
      path.join(here, "fixtures", "verify-stamp.flow.yaml"),
      path.join(ws, "flows", "verify.flow.yaml"),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(ws, { recursive: true, force: true });
  });

  async function verify(mode: VerifyPageMode, extra: string[]) {
    const server = await serveVerifyPage(mode);
    try {
      await fs.writeFile(
        path.join(ws, ".docsxai.json"),
        JSON.stringify({
          schema: "docsxai/workspace@1",
          app_url: server.baseURL,
          created_at: "2030-01-01T00:00:00.000Z",
        }),
      );
      const code = await main(["run", ws, "--verify-determinism", "--format", "json", ...extra]);
      return { code, report: JSON.parse(out) as VerifyReport, requests: server.requests() };
    } finally {
      await server.close();
    }
  }

  it(
    "passes on the deterministic page, promotes run 1 and removes the run roots",
    // 240s headroom: three runs each launch and gracefully close a real Chromium.
    { timeout: 240_000 },
    async () => {
      const { code, report, requests } = await verify("stable", ["--runs", "3"]);
      expect(code).toBe(0);
      expect(report.status).toBe("identical");
      expect(report.runs).toBe(3);
      expect(report.flows).toEqual(["verify"]);
      expect(report.first).toBeNull();
      expect(report.differences).toEqual([]);
      expect(report.promoted).toBe(true);
      expect(requests).toBe(3);
      expect(err).toMatch(/verify-determinism: run 3 of 3/);

      const shot = path.join(ws, "docs", "verify", "screenshots", "stamp.png");
      expect((await fs.stat(shot)).size).toBeGreaterThan(0);
      const annotations = JSON.parse(
        await fs.readFile(path.join(ws, "docs", "verify", "annotations.json"), "utf8"),
      );
      expect(annotations.annotations).toHaveLength(1);
      expect(await exists(path.join(ws, ".docsxai-verify"))).toBe(false);
    },
  );

  it(
    "fails on the injected page and names the stamp screenshot",
    { timeout: 240_000 },
    async () => {
      const { code, report, requests } = await verify("flaky", []);
      expect(code).toBe(1);
      expect(report.status).toBe("differing");
      expect(report.promoted).toBe(false);
      expect(requests).toBe(2);

      // Only the stamp's pixels move: the annotation box is the same, so annotations.json is identical.
      expect(report.differences.map((d) => d.path)).toEqual(["docs/verify/screenshots/stamp.png"]);
      const first = report.first!;
      expect(first.path).toBe("docs/verify/screenshots/stamp.png");
      expect(first.run).toBe(2);
      expect(first.kind).toBe("png");
      expect(first.changed_pixel_count).toBeGreaterThan(0);
      expect(first.region!.width).toBeLessThanOrEqual(80);
      expect(first.region!.height).toBeLessThanOrEqual(40);
      expect(first.hint).toMatch(/pixels differ/);
      expect(formatVerifyReportText(report)).toMatch(
        /first differing artefact: docs\/verify\/screenshots\/stamp\.png \(run 2 vs run 1\)/,
      );

      // The workspace was not written to, and the run roots are gone.
      expect(await exists(path.join(ws, "docs"))).toBe(false);
      expect(await exists(path.join(ws, ".docsxai-verify"))).toBe(false);
    },
  );
});
