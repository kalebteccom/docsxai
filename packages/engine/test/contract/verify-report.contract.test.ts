// Contract: the `docsxai/verify-determinism@1` report that `docsxai run --verify-determinism`
// prints, the flags that switch the mode on, and the exit codes it maps to.
//
// Snapshot: snapshots/verify-report.json. The report and difference shapes are read from the
// interfaces in verify-report.ts and verify-compare.ts (source text, syntax only); the schema id
// and an empty report come from `buildVerifyReport`. The run-count bounds and the scratch
// directory name are exported constants.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed or renamed report field, a removed status or difference
//      kind, or a changed meaning needs a new schema id (`docsxai/verify-determinism@2`); a new
//      optional field is additive.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expectJsonSnapshot,
  stringUnion,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import { parseVerifyArgs } from "../../src/cli-verify.js";
import { buildVerifyReport, verifyExitCode } from "../../src/verify-report.js";
import { DEFAULT_RUNS, MAX_RUNS, MIN_RUNS, VERIFY_DIR } from "../../src/verify-determinism.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "src");
const reportSource = path.join(src, "verify-report.ts");
const compareSource = path.join(src, "verify-compare.ts");

const flags = (entries: Array<[string, string | true]>) => new Map(entries);

describe("verify-determinism report contract", () => {
  const report = (overrides: Partial<Parameters<typeof buildVerifyReport>[0]> = {}) =>
    buildVerifyReport({
      runs: 2,
      flows: ["b", "a"],
      artefactsCompared: 0,
      differences: [],
      halts: [],
      promoted: true,
      ...overrides,
    });

  it("matches the checked-in report snapshot", () => {
    expectJsonSnapshot(path.join(here, "snapshots", "verify-report.json"), {
      schema: report().schema,
      emptyReport: report(),
      statuses: stringUnion(reportSource, "VerifyStatus"),
      differenceKinds: stringUnion(compareSource, "DifferenceKind"),
      runs: { min: MIN_RUNS, max: MAX_RUNS, default: DEFAULT_RUNS },
      scratchDir: VERIFY_DIR,
      types: {
        VerifyReport: typeMembers(reportSource, "VerifyReport"),
        VerifyHalt: typeMembers(reportSource, "VerifyHalt"),
        ArtefactDifference: typeMembers(compareSource, "ArtefactDifference"),
      },
    });
  });

  it("maps identical to exit 0 and differing or halted to exit 1", () => {
    const difference = {
      path: "docs/f/annotations.json",
      run: 2,
      kind: "json" as const,
      hint: "x",
    };
    const halt = { run: 1, flow: "f", step: "open", message: "halted" };
    expect(verifyExitCode(report())).toBe(0);
    expect(verifyExitCode(report({ differences: [difference] }))).toBe(1);
    expect(verifyExitCode(report({ halts: [halt] }))).toBe(1);
    expect(report({ differences: [difference] }).status).toBe("differing");
    expect(report({ differences: [difference], halts: [halt] }).status).toBe("halted");
  });
});

describe("verify-determinism flag contract", () => {
  it("is off without --verify-determinism, and --runs and --format need it", () => {
    expect(parseVerifyArgs(flags([]))).toBeNull();
    expect(parseVerifyArgs(flags([["runs", "3"]]))).toMatch(/--runs requires --verify-determinism/);
    expect(parseVerifyArgs(flags([["format", "json"]]))).toMatch(
      /--format requires --verify-determinism/,
    );
  });

  it("defaults to 2 runs and the text format", () => {
    expect(parseVerifyArgs(flags([["verify-determinism", true]]))).toEqual({
      runs: 2,
      format: "text",
    });
  });

  it("takes 2 to 5 runs and the formats json, md and text", () => {
    for (const format of ["json", "md", "text"]) {
      expect(
        parseVerifyArgs(
          flags([
            ["verify-determinism", true],
            ["runs", "5"],
            ["format", format],
          ]),
        ),
      ).toEqual({ runs: 5, format });
    }
    for (const runs of ["1", "6", "two"]) {
      expect(
        parseVerifyArgs(
          flags([
            ["verify-determinism", true],
            ["runs", runs],
          ]),
        ),
      ).toMatch(/--runs must be an integer from 2 to 5/);
    }
    expect(
      parseVerifyArgs(
        flags([
          ["verify-determinism", true],
          ["format", "xml"],
        ]),
      ),
    ).toMatch(/--format must be json \| md \| text/);
  });

  it.each(["pause", "stop-after", "start-from", "cdp"])("cannot be combined with --%s", (flag) => {
    expect(
      parseVerifyArgs(
        flags([
          ["verify-determinism", true],
          [flag, flag === "pause" ? true : "x"],
        ]),
      ),
    ).toMatch(new RegExp(`--verify-determinism cannot be combined with --${flag}`));
  });
});
