// ESLint flat-config for docsxai.
//
// Style + lint baseline. Load-bearing rules ship as `error` from day one;
// noisier rules ship as `warn` and get promoted in a follow-up phase that
// converges to zero warns. Two custom rules are wired here:
//
//   - tracker-id ban — comments must not contain project-management IDs
//     ("W-" + letter + digit, Round-N, ask-#-N, JIRA-style, LINEAR-style,
//     GEN-N, T-N, "R" + digits + "-#" + digits). These are PM artifacts,
//     not code context — they rot, mean nothing to a future reader, and
//     belong in the commit/PR body. Comments should state the actual
//     reason.
//
//   - page-eval-stringified-arrow — flags page.evaluate() / evaluateHandle()
//     / evaluateAll() called with a TemplateLiteral or string Literal.
//     Stringified arrows lose the closure, capture nothing, and silently
//     mis-evaluate. Use a function-expression argument instead. Carried
//     forward as defense-in-depth even though docsxai's current packages
//     don't expose a page-side execution layer — zero violations expected,
//     and the rule remains in place for the day flow-runtime grows one.
//
// Both ship as `error`; both have zero violations in the current tree.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";
import globals from "globals";

const TRACKER_ID_PATTERN =
  "\\b(W-[A-Z]\\d+|Round-?\\d+|ask\\s*#\\d+|TICKET-\\d+|JIRA-\\d+|LINEAR-\\d+|GEN-\\d+|T-\\d+|R\\d+-#\\d+)\\b";

// Custom rule: ban tracker-style IDs in comments.
const noTrackerIdsInComments = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow project-management tracker IDs in comments (Webwright / Round / ask / JIRA / LINEAR / GEN / T / Rnd-# style).",
    },
    schema: [],
    messages: {
      trackerId:
        'Tracker IDs (W-/Round-/ask #/JIRA-/LINEAR-/GEN-/T-/R-style) do not belong in code comments — they are project-management artifacts that rot and mean nothing to a future reader. State the actual reason instead. (Matched: "{{ match }}")',
    },
  },
  create(context) {
    const re = new RegExp(TRACKER_ID_PATTERN);
    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        for (const comment of sourceCode.getAllComments()) {
          const m = comment.value.match(re);
          if (m) {
            context.report({
              loc: comment.loc,
              messageId: "trackerId",
              data: { match: m[0] },
            });
          }
        }
      },
    };
  },
};

// Custom rule: flag page.evaluate(`...`) / page.evaluate("...") — stringified
// arrows / strings as the first arg are the foot-gun we keep hitting.
const noPageEvalStringifiedArrow = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow string / template-literal first arg to page.evaluate / evaluateHandle / evaluateAll — pass a function instead.",
    },
    schema: [],
    messages: {
      stringified:
        "page.{{ name }}() called with a {{ kind }} first argument. Stringified arrows lose their closure and execute as opaque source — pass a function expression instead and forward captured values via the second argument.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || !callee.property) return;
        const name = callee.property.name;
        if (name !== "evaluate" && name !== "evaluateHandle" && name !== "evaluateAll") {
          return;
        }
        const first = node.arguments[0];
        if (!first) return;
        if (first.type === "TemplateLiteral") {
          context.report({
            node: first,
            messageId: "stringified",
            data: { name, kind: "template literal" },
          });
        } else if (first.type === "Literal" && typeof first.value === "string") {
          context.report({
            node: first,
            messageId: "stringified",
            data: { name, kind: "string literal" },
          });
        }
      },
    };
  },
};

const docsxaiLocal = {
  rules: {
    "no-tracker-ids-in-comments": noTrackerIdsInComments,
    "no-page-eval-stringified-arrow": noPageEvalStringifiedArrow,
  },
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "packages/*/dist/**",
      "node_modules/**",
      "packages/*/node_modules/**",
      "coverage/**",
      "artifacts/**",
      ".worktrees/**",
      "**/*.generated.*",
      ".claude/**",
      // Astro build output + astro-generated types for the docs site.
      "website/dist/**",
      "website/.astro/**",
    ],
  },
  js.configs.recommended,
  // Base JS/non-TS rules — no type-aware rules here so .js/.mjs/.cjs lint.
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      "import-x": importPlugin,
      "docsxai-local": docsxaiLocal,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
      "import-x/no-duplicates": "error",
      "docsxai-local/no-tracker-ids-in-comments": "error",
      "docsxai-local/no-page-eval-stringified-arrow": "error",
    },
  },
  // Type-aware TS rules — scoped to .ts/.tsx, with projectService so
  // typescript-eslint picks the right tsconfig per file (root + workspace
  // packages) without us listing every one.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "import-x": importPlugin,
      "docsxai-local": docsxaiLocal,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
      parserOptions: {
        // tsconfig.eslint.json explicitly widens include to cover packages/
        // src + test trees that the per-package tsconfigs intentionally
        // exclude. Used for lint only — never emits.
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Load-bearing async-safety — error from day one.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Unused-var hygiene — `^_` escape for the intentional case.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Strict-type hygiene — error from day one. Mirrors browxai's
      // strict-type baseline.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/unbound-method": "error",

      // DEFERRED to a follow-up typed-boundary refactor. Same posture as
      // browxai: the right fix is typed wrappers at the
      // backend-API / flow-file / page.evaluate() boundaries that Zod-
      // validate inbound payloads so handler bodies see typed objects,
      // not `unknown` JSON.parse output. Until those wrappers land,
      // gating these as errors would block load-bearing integration code.
      // Re-enable as `error` once the boundary wrappers are in place.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      // Catches load-bearing `as T` and `!` assertions; necessary ones
      // get a per-line disable + WHY. no-unnecessary-non-null-assertion
      // does not exist in @typescript-eslint v8 — the unnecessary-`!`
      // case is covered by no-unnecessary-type-assertion.
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // Ban undocumented ts-ignore / ts-expect-error.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
          "ts-check": false,
          minimumDescriptionLength: 5,
        },
      ],

      "no-console": ["error", { allow: ["error", "warn"] }],

      "import-x/no-duplicates": "error",

      // docsxai-specific custom rules — error from day one.
      "docsxai-local/no-tracker-ids-in-comments": "error",
      "docsxai-local/no-page-eval-stringified-arrow": "error",
    },
  },
  // Test files — relax async-safety + console hygiene.
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "packages/*/test/**/*.ts",
      "test/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      // Tests routinely coerce `unknown` payloads (e.g. captured warn-call
      // args from a vitest spy) into strings for regex-matchers — `String(x
      // ?? "")` is the pattern of record. Off here; production code still
      // gates as error.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  // Tooling scripts — console is the output channel.
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.js", "scripts/**/*.ts", "website/scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Config files.
  {
    files: ["*.config.{ts,js,mjs}", "vitest.*.config.ts", "eslint.config.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
  // Module/file-size discipline - docs/ai-context/architecture/module-and-file-size.md.
  // Whole-tree file-size ceiling across every production package-src file. docsxai
  // historically shipped no max-lines rule, which is how engine/cli.ts reached
  // ~1700 lines. Calibrated at 450 (the family number); pre-existing god-files are
  // parked in the cap-debt allowlist below with a split reason, de-allowlisted and
  // the ceiling ratcheted down as the refactor waves land. Tests/scripts/config
  // are excluded (colocated tests carry table-driven bulk legitimately).
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.ts", "**/*.d.ts"],
    rules: {
      "max-lines": ["error", { max: 450, skipBlankLines: true, skipComments: true }],
    },
  },
  // cap-debt allowlist - files over the 450 ceiling when the budget landed. The
  // ceiling is REMOVED here (not raised) so each file is visibly parked, not
  // silently passing, and is restored as its split lands. No NEW file may join
  // this list. Each split is tracked in docs/ai-context/architecture/module-and-file-size.md:
  //   engine/cli.ts          - thin dispatch table + one file per subcommand body
  //   engine/backend-client.ts - transport/auth client vs request builders
  //   backend/server.ts      - route handlers vs server composition
  {
    files: [
      "packages/engine/src/cli.ts",
      "packages/engine/src/backend-client.ts",
      "packages/backend/src/server.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  // Load-bearing boundaries, mechanized (AGENTS.md two-mode contract +
  // architecture-principles.md §1). Two import bans across all production src:
  //   1. No model-provider SDK - the engine never calls a model API; inference
  //      comes from the host agent over MCP. Provider SDKs live in the future
  //      SaaS surface, not this repo.
  //   2. No Playwright outside the driver - everything depends on the
  //      `BrowserDriver` interface; only playwright-driver.ts and
  //      playwright-instrumented-browser.ts may import playwright-core.
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "openai",
                "openai/*",
                "@anthropic-ai/*",
                "@google/genai",
                "@google/generative-ai",
                "@mistralai/*",
                "cohere-ai",
                "@aws-sdk/client-bedrock*",
                "@azure/openai",
                "groq-sdk",
                "ollama",
              ],
              message:
                "The engine never calls a model API (AGENTS.md two-mode contract). Inference comes from the host agent over MCP; provider SDKs live in the future SaaS surface, not this repo.",
            },
            {
              group: ["playwright", "playwright-core", "playwright-core/*"],
              message:
                "Only playwright-driver.ts / playwright-instrumented-browser.ts may import Playwright. Everything else depends on the BrowserDriver interface (architecture-principles.md §1).",
            },
          ],
        },
      ],
    },
  },
  // The single Playwright integration point: re-allow playwright-core here (the
  // model-SDK ban still applies, re-stated since no-restricted-imports replaces).
  {
    files: [
      "packages/engine/src/playwright-driver.ts",
      "packages/engine/src/playwright-instrumented-browser.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "openai",
                "openai/*",
                "@anthropic-ai/*",
                "@google/genai",
                "@google/generative-ai",
                "@mistralai/*",
                "cohere-ai",
                "@aws-sdk/client-bedrock*",
                "@azure/openai",
                "groq-sdk",
                "ollama",
              ],
              message: "The engine never calls a model API (AGENTS.md two-mode contract).",
            },
          ],
        },
      ],
    },
  },
);
