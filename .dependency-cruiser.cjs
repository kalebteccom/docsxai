// Dependency-direction + no-circular gate. Run via `pnpm depcruise`.
//
// The two load-bearing IMPORT bans - no `playwright-core` outside the driver, no
// model-provider SDK anywhere - are enforced at the lint layer (eslint
// `no-restricted-imports`, see eslint.config.js). This gate adds the graph-level
// invariant eslint cannot express: no import cycles anywhere in production source.
// See docs/ai-context/architecture/fitness-functions.md.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "No RUNTIME import cycles - a cycle makes the module graph impossible to reason about in isolation and defeats incremental build. Break it by lifting the shared piece into a leaf both sides import. Type-only cycles are excluded: they are erased at compile and do not exist at runtime (e.g. playwright-driver.ts importing `type StorageState` from auth.ts).",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
  ],
  options: {
    doNotFollow: { path: "(node_modules|dist)" },
    exclude: { path: "(node_modules|/dist/|\\.test\\.|\\.spec\\.|/test/)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
