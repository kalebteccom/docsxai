// Contract: the programmatic surface of `@docsxai/engine` that is a stable candidate, plus the
// vocabulary of the authoring aids (`lint` rule codes, `diagnose` recommendation kinds).
//
// The library entry (`src/index.ts`) re-exports far more than the 1.0 promise covers, so the
// export check is one-directional: every name in snapshots/engine-library.json must stay exported.
// New exports do not fail it. The lint codes and diagnose kinds are exact snapshots.
//
// Update procedure (never automatic):
//   - engine-library.json (a removed export fails): to promote an export to the stable list, add
//     its name by hand and list it in docs/public-surface.md. To remove one, that is a breaking
//     change: add a CHANGELOG entry and drop the name.
//   - authoring-aids.json: run this file once with UPDATE_CONTRACT_SNAPSHOTS=1 (it rewrites the
//     snapshot and fails), review the diff, update docs/public-surface.md and the CHANGELOG, then
//     run the file again without the variable. A removed lint code or recommendation kind is a
//     breaking change for tools that read `--format json`.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expectJsonSnapshot,
  readSource,
  stringUnion,
} from "../../../../scripts/contract-support.js";
import * as engine from "../../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "src");

describe("engine library contract", () => {
  it("keeps every stable-candidate export", () => {
    const stable = JSON.parse(
      readFileSync(path.join(here, "snapshots", "engine-library.json"), "utf8"),
    ) as { stableExports: string[] };
    const exported = new Set(Object.keys(engine));
    expect(stable.stableExports.filter((name) => !exported.has(name))).toEqual([]);
  });

  it("matches the checked-in authoring-aids snapshot", () => {
    // `lintFlow` runs the rules in flow-lint.ts and the matrix rules in flow-matrix-lint.ts.
    const lintCodes = [
      ...new Set(
        ["flow-lint.ts", "flow-matrix-lint.ts"].flatMap((file) =>
          [...readSource(path.join(src, file)).matchAll(/code: "(R\d{3})"/g)].map((m) => m[1]!),
        ),
      ),
    ].sort();
    expectJsonSnapshot(path.join(here, "snapshots", "authoring-aids.json"), {
      lintCodes,
      diagnoseKinds: stringUnion(path.join(src, "diagnose.ts"), "DiagnoseRecommendationKind"),
    });
  });
});
