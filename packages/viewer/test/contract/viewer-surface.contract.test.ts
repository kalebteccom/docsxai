// Contract: the `docsxai-viewer` CLI (commands, flags, exit codes), the shape of the burn report
// (`docsxai/burn-report@1`) and the screens pack (`docsxai/screens-pack@2`, `pack.json`, the drift
// report).
//
// Snapshot: snapshots/viewer-surface.json. The usage lines come from the help text the bin prints,
// the report shape from `burnReport` and the interfaces in `src/burn-report.ts` (read from source
// text, syntax only). The pack section holds the schema ids, file names, id grammar and the
// manifest and drift types from `src/pack-schema.ts` and `src/pack-drift.ts`. The viewer's
// structural mirror of the annotation records is pinned too; the engine's contract tests check it
// against the engine's Zod schema.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed command, flag or report field is a breaking change; a new
//      optional flag or report field is additive. A changed meaning of an existing report field
//      needs a new schema id (`docsxai/burn-report@2`).
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectJsonSnapshot,
  stringUnion,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import { BURN_REPORT_SCHEMA, burnReport, runViewerCli } from "../../src/index.js";
import { SCREENS_MANIFEST_V1, SCREENS_PACK_V1 } from "../../src/pack-convert.js";
import { DEFAULT_THRESHOLD_PCT } from "../../src/pack-drift.js";
import { OXIPNG_BIN_ENV } from "../../src/pack-optimise.js";
import {
  DEFAULT_PUBLIC_PREFIX,
  HASH8_PATTERN,
  ID_MAX,
  ID_PATTERN,
  LOCALE_PATTERN,
  PACK_MANIFEST_FILE,
  SCREENS_PACK_SCHEMA,
  THEME_PATTERN,
  VIEWPORT_PATTERN,
} from "../../src/pack-schema.js";
import { PACK_CONFIG_FILE, PACK_CONFIG_SCHEMA } from "../../src/pack-workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "src");

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

describe("viewer surface contract", () => {
  it("matches the checked-in viewer snapshot", async () => {
    expect(await runViewerCli([])).toBe(0);
    const usage = out
      .split("\n")
      .filter((line) => /^ {2}docsxai-viewer /.test(line))
      .map((line) => line.trim().replace(/\s+/g, " "));
    const empty = burnReport([]);
    expectJsonSnapshot(path.join(here, "snapshots", "viewer-surface.json"), {
      usage,
      burnReport: {
        schema: BURN_REPORT_SCHEMA,
        emptyReport: empty,
        types: {
          BurnReport: typeMembers(path.join(src, "burn-report.ts"), "BurnReport"),
          FlowBurnReport: typeMembers(path.join(src, "burn-report.ts"), "FlowBurnReport"),
          AnnotationReport: typeMembers(path.join(src, "burn-report.ts"), "AnnotationReport"),
        },
      },
      pack: {
        schema: SCREENS_PACK_SCHEMA,
        manifestFile: PACK_MANIFEST_FILE,
        configSchema: PACK_CONFIG_SCHEMA,
        configFile: PACK_CONFIG_FILE,
        convertsFrom: [SCREENS_PACK_V1, SCREENS_MANIFEST_V1],
        defaults: {
          publicPrefix: DEFAULT_PUBLIC_PREFIX,
          driftThresholdPct: DEFAULT_THRESHOLD_PCT,
        },
        oxipngBinEnv: OXIPNG_BIN_ENV,
        grammar: {
          id: ID_PATTERN.source,
          idMax: ID_MAX,
          locale: LOCALE_PATTERN.source,
          theme: THEME_PATTERN.source,
          viewport: VIEWPORT_PATTERN.source,
          hash8: HASH8_PATTERN.source,
        },
        types: {
          ScreensPack: typeMembers(path.join(src, "pack-schema.ts"), "ScreensPack"),
          PackFlow: typeMembers(path.join(src, "pack-schema.ts"), "PackFlow"),
          PackStep: typeMembers(path.join(src, "pack-schema.ts"), "PackStep"),
          PackVariant: typeMembers(path.join(src, "pack-schema.ts"), "PackVariant"),
          PackCallout: typeMembers(path.join(src, "pack-schema.ts"), "PackCallout"),
          DriftReport: typeMembers(path.join(src, "pack-drift.ts"), "DriftReport"),
          DriftEntry: typeMembers(path.join(src, "pack-drift.ts"), "DriftEntry"),
        },
        driftStatuses: stringUnion(path.join(src, "pack-drift.ts"), "DriftStatus"),
      },
      annotationsMirror: {
        AnnotationsFile: typeMembers(path.join(src, "annotations.ts"), "AnnotationsFile"),
        AnnotationRecord: typeMembers(path.join(src, "annotations.ts"), "AnnotationRecord"),
        AnnotationPlacement: typeMembers(path.join(src, "annotations.ts"), "AnnotationPlacement"),
        BoundingBox: typeMembers(path.join(src, "annotations.ts"), "BoundingBox"),
        NudgeOffset: typeMembers(path.join(src, "annotations.ts"), "NudgeOffset"),
      },
    });
  });
});

describe("viewer exit-code contract", () => {
  it("exits 2 on an unknown command and prints the help", async () => {
    expect(await runViewerCli(["no-such-command"])).toBe(2);
    expect(out).toMatch(/Usage:/);
  });

  it.each([["build"], ["build", "only-one-arg"], ["burn"], ["site"]])(
    "exits 2 on `%s` with missing arguments",
    async (...argv) => {
      expect(await runViewerCli(argv)).toBe(2);
      expect(err).toMatch(/requires/);
    },
  );

  it("exits 2 on `pack` and `drift` without a directory, and on `drift` without --against", async () => {
    expect(await runViewerCli(["pack"])).toBe(2);
    expect(err).toMatch(/pack: missing <workspace-or-raw-dir>/);
    err = "";
    expect(await runViewerCli(["drift"])).toBe(2);
    expect(err).toMatch(/drift: missing <workspace-or-raw-dir>/);
    err = "";
    expect(await runViewerCli(["drift", "some-dir"])).toBe(2);
    expect(err).toMatch(/drift: --against <pack-dir> is required/);
  });

  it("exits 2 on an unknown `pack` flag", async () => {
    expect(await runViewerCli(["pack", "some-dir", "--no-such-flag"])).toBe(2);
    expect(err).toMatch(/pack: unknown flag --no-such-flag/);
  });

  it("exits 2 when --max-overlap is not a number", async () => {
    expect(await runViewerCli(["burn", "some-workspace", "--max-overlap", "nope"])).toBe(2);
    expect(err).toMatch(/--max-overlap needs a number/);
  });
});
