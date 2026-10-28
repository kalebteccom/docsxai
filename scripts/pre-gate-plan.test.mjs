// Tests for the pure helpers behind scripts/pre-gate.mjs. No git state needed.
// Run with `node --test scripts/pre-gate-plan.test.mjs`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyEslint,
  DEFAULT_BASE,
  eslintFiles,
  packageDirOf,
  parseArgs,
  prettierFiles,
  splitNames,
  testPlan,
  typecheckPackages,
  UNVERIFIED_RULES,
  workspaceDepNames,
} from "./pre-gate-plan.mjs";

describe("parseArgs", () => {
  it("defaults the base and reads --base", () => {
    assert.deepEqual(parseArgs([]), { base: DEFAULT_BASE });
    assert.deepEqual(parseArgs(["--base", "refs/heads/x"]), { base: "refs/heads/x" });
  });
  it("rejects a missing value and unknown flags", () => {
    assert.throws(() => parseArgs(["--base"]), /needs a ref/);
    assert.throws(() => parseArgs(["--nope"]), /unknown argument/);
  });
});

describe("file selection", () => {
  it("merges, de-duplicates and sorts name lists", () => {
    assert.deepEqual(splitNames("b.ts\0a.ts\0", "a.ts\nc.md\n", ""), ["a.ts", "b.ts", "c.md"]);
  });
  it("picks prettier and eslint files by extension", () => {
    const files = ["a.ts", "b.mjs", "c.md", "d.json", "e.astro", "f.png", "Makefile", "x/y.tsx"];
    assert.deepEqual(prettierFiles(files), ["a.ts", "b.mjs", "c.md", "d.json", "x/y.tsx"]);
    assert.deepEqual(eslintFiles(files), ["a.ts", "b.mjs", "x/y.tsx"]);
  });
  it("finds the package dir of a file", () => {
    assert.equal(packageDirOf("packages/engine/src/a.ts"), "packages/engine");
    assert.equal(packageDirOf("website/src/a.ts"), null);
    assert.equal(packageDirOf("packages/README.md"), null);
  });
  it("typechecks touched packages that have a tsconfig, never the website", () => {
    const has = (dir) => dir !== "packages/plugin";
    const files = [
      "packages/engine/src/a.ts",
      "packages/engine/test/b.test.ts",
      "packages/plugin/x.md",
      "website/src/a.ts",
    ];
    assert.deepEqual(typecheckPackages(files, has), ["packages/engine"]);
  });
  it("reads workspace deps from a manifest", () => {
    const pkg = {
      dependencies: { "@docsxai/engine": "workspace:*", zod: "^3.0.0" },
      devDependencies: { "@docsxai/viewer": "workspace:^" },
    };
    assert.deepEqual(workspaceDepNames(pkg), ["@docsxai/engine", "@docsxai/viewer"]);
    assert.deepEqual(workspaceDepNames({}), []);
  });
});

describe("testPlan", () => {
  const guards = ["website/scripts/check-a.test.mjs", "website/scripts/check-b.test.mjs"];
  it("groups package tests per package with package-relative paths", () => {
    const plan = testPlan(
      [
        "packages/engine/test/z.test.ts",
        "packages/engine/test/a.test.ts",
        "packages/mcp/test/m.test.ts",
        "packages/engine/src/a.ts",
      ],
      guards,
    );
    assert.deepEqual(plan.vitest, [
      { pkg: "packages/engine", files: ["test/a.test.ts", "test/z.test.ts"] },
      { pkg: "packages/mcp", files: ["test/m.test.ts"] },
    ]);
    assert.deepEqual(plan.node, []);
  });
  it("runs changed script tests with node", () => {
    const plan = testPlan(["scripts/pre-gate-plan.test.mjs", "scripts/pre-gate.mjs"], guards);
    assert.deepEqual(plan.node, ["scripts/pre-gate-plan.test.mjs"]);
  });
  it("adds every website guard when anything under website/ changed", () => {
    const plan = testPlan(["website/src/pages/index.astro"], guards);
    assert.deepEqual(plan.node, guards);
    assert.deepEqual(testPlan(["docs/a.md"], guards), { vitest: [], node: [] });
  });
  it("does not list a guard twice when it changed itself", () => {
    const plan = testPlan(["website/scripts/check-a.test.mjs"], guards);
    assert.deepEqual(plan.node, guards);
  });
});

describe("classifyEslint", () => {
  const rule = UNVERIFIED_RULES[0];
  const results = [
    {
      filePath: "/r/packages/engine/src/a.ts",
      messages: [
        { ruleId: rule, severity: 2, line: 3, message: "unnecessary" },
        { ruleId: "no-unused-vars", severity: 2, line: 9, message: "unused" },
        { ruleId: "no-console", severity: 1, line: 1, message: "console" },
        { ruleId: null, severity: 2, line: 1, message: "Parsing error" },
      ],
    },
  ];
  it("moves the type-aware rules to unverified when dist is missing", () => {
    const c = classifyEslint(results, { distMissing: true, root: "/r/" });
    assert.equal(c.unverified.length, 1);
    assert.equal(c.errors.length, 2);
    assert.equal(c.warnings, 1);
    assert.match(c.errors[0], /^packages\/engine\/src\/a\.ts:9: unused/);
    assert.match(c.errors[1], /parse error/);
  });
  it("keeps them as errors when dist exists", () => {
    const c = classifyEslint(results, { distMissing: false });
    assert.equal(c.unverified.length, 0);
    assert.equal(c.errors.length, 3);
  });
  it("lists exactly the three known rules", () => {
    assert.deepEqual(
      UNVERIFIED_RULES.map((r) => r.split("/").pop()),
      [
        "no-unnecessary-type-assertion",
        "no-redundant-type-constituents",
        "restrict-template-expressions",
      ],
    );
  });
});
