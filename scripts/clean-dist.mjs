#!/usr/bin/env node
// Removes the invoking package's dist/ and tsc build-info so stale compiled
// artifacts (outputs of since-deleted sources, leftover .map files) can never
// survive into the next build — or into a published tarball ("files": ["dist"]
// ships whatever is there). Both targets must go together: `tsc -b` trusts its
// .tsbuildinfo over the real dist/ contents, so removing dist/ alone makes the
// next build skip emit and leave dist/ empty.
//
// Runs with cwd = the package dir (pnpm runs package scripts there).
import { rmSync } from "node:fs";

for (const target of ["dist", "tsconfig.build.tsbuildinfo"]) {
  rmSync(target, { recursive: true, force: true });
}
