// Contract: the `BrowserDriver` interface a third-party driver implements.
//
// Snapshot: snapshots/browser-driver.json, every member of `interface BrowserDriver` in
// flow-runtime.ts with its normalized signature, the list of optional members, and the values
// `actionable()` may return. The interface only exists as TypeScript, so the test reads the source
// text with the TypeScript parser (syntax only, no program). `PlaywrightDriver` must keep
// implementing every required method at runtime.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A new required method, a removed method or a changed parameter
//      breaks every third-party driver; a new optional method or a new optional trailing
//      parameter is additive.
//   3. Update docs/public-surface.md and add a CHANGELOG entry that tells driver authors what to do.
//   4. Run the file again without the variable.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  expectJsonSnapshot,
  stringUnion,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import { PlaywrightDriver } from "../../src/playwright-driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = path.join(here, "..", "..", "src", "flow-runtime.ts");

describe("BrowserDriver contract", () => {
  const driver = typeMembers(runtimeSource, "BrowserDriver");

  it("matches the checked-in interface snapshot", () => {
    expectJsonSnapshot(path.join(here, "snapshots", "browser-driver.json"), {
      members: driver.members,
      optional: driver.optional,
      actionableStates: stringUnion(runtimeSource, "ActionableState"),
    });
  });

  it("is implemented by PlaywrightDriver, optional methods included", () => {
    const implemented = new Set(Object.getOwnPropertyNames(PlaywrightDriver.prototype));
    const missing = Object.keys(driver.members).filter((name) => !implemented.has(name));
    expect(missing).toEqual([]);
  });
});
