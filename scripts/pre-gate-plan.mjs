// scripts/pre-gate-plan.mjs
//
// The pure helpers behind scripts/pre-gate.mjs: which changed files each local check covers, and
// how to read ESLint output when workspace packages are not built. No git, no file system, no
// child processes, so a test can import them.

export const DEFAULT_BASE = "refs/remotes/origin/main";

const PRETTIER_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);
const ESLINT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/** Type-aware rules that give false positives while workspace packages have no dist. */
export const UNVERIFIED_RULES = [
  "@typescript-eslint/no-unnecessary-type-assertion",
  "@typescript-eslint/no-redundant-type-constituents",
  "@typescript-eslint/restrict-template-expressions",
];

/** `{ base }` from argv. Throws on an unknown flag or a missing value. */
export function parseArgs(argv) {
  let base = DEFAULT_BASE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") {
      const value = argv[++i];
      if (!value) throw new Error("--base needs a ref");
      base = value;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { base };
}

/** Sorted, de-duplicated paths from `git ... --name-only` output (newline or NUL separated). */
export function splitNames(...outputs) {
  const names = new Set();
  for (const out of outputs) {
    for (const name of out.split(/[\0\n]/)) if (name.trim()) names.add(name);
  }
  return [...names].sort();
}

function extOf(file) {
  const dot = file.lastIndexOf(".");
  return dot < 0 || file.lastIndexOf("/") > dot ? "" : file.slice(dot);
}

export const prettierFiles = (files) => files.filter((f) => PRETTIER_EXT.has(extOf(f)));
export const eslintFiles = (files) => files.filter((f) => ESLINT_EXT.has(extOf(f)));

/** `packages/<name>` for a file inside a workspace package, else null. */
export function packageDirOf(file) {
  const m = /^(packages\/[^/]+)\//.exec(file);
  return m ? m[1] : null;
}

/**
 * Package dirs to typecheck: every `packages/*` dir with a changed file and a tsconfig. The
 * website has its own tsconfig but needs generated Astro types, so it is left to CI.
 * @param {string[]} files
 * @param {(dir: string) => boolean} hasTsconfig
 */
export function typecheckPackages(files, hasTsconfig) {
  const dirs = new Set();
  for (const file of files) {
    const dir = packageDirOf(file);
    if (dir && hasTsconfig(dir)) dirs.add(dir);
  }
  return [...dirs].sort();
}

/** Workspace dependency names (`workspace:` ranges) from a parsed package.json. */
export function workspaceDepNames(pkg) {
  const names = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(pkg?.[field] ?? {})) {
      if (typeof range === "string" && range.startsWith("workspace:")) names.add(name);
    }
  }
  return [...names].sort();
}

const isTestFile = (f) => /\.test\.(ts|tsx|mjs|js)$/.test(f);

/**
 * Single-file test runs for the changed files.
 *  - `vitest`: changed `packages/<p>/test/**` test files, grouped per package, paths relative to it.
 *  - `node`: changed `.test.mjs` files under scripts/ or website/scripts/, plus every
 *    `website/scripts/check-*.test.mjs` guard when anything under `website/` changed.
 * @param {string[]} files changed files, repo-relative
 * @param {string[]} guardTests repo-relative paths of the website guard tests that exist
 */
export function testPlan(files, guardTests) {
  const perPackage = new Map();
  const node = new Set();
  for (const file of files) {
    const dir = packageDirOf(file);
    if (dir && isTestFile(file) && file.startsWith(`${dir}/test/`) && !file.endsWith(".mjs")) {
      const list = perPackage.get(dir) ?? [];
      list.push(file.slice(dir.length + 1));
      perPackage.set(dir, list);
    } else if (/^(website\/)?scripts\/[^/]+\.test\.mjs$/.test(file)) {
      node.add(file);
    }
  }
  if (files.some((f) => f.startsWith("website/"))) {
    for (const guard of guardTests) node.add(guard);
  }
  return {
    vitest: [...perPackage].sort().map(([pkg, tests]) => ({ pkg, files: tests.sort() })),
    node: [...node].sort(),
  };
}

/**
 * Split ESLint JSON results (`--format json`) into failures and notes.
 * Warnings never fail. With `distMissing`, the three type-aware rules in UNVERIFIED_RULES move
 * from errors to `unverified`.
 * @param {Array<{ filePath: string, messages: Array<{ ruleId: string | null, severity: number, line: number, message: string }> }>} results
 * @param {{ distMissing: boolean, root?: string }} opts
 */
export function classifyEslint(results, { distMissing, root = "" }) {
  const errors = [];
  const unverified = [];
  let warnings = 0;
  for (const result of results) {
    const file =
      root && result.filePath.startsWith(root)
        ? result.filePath.slice(root.length)
        : result.filePath;
    for (const msg of result.messages) {
      if (msg.severity < 2) {
        warnings++;
        continue;
      }
      const line = `${file}:${msg.line}: ${msg.message} (${msg.ruleId ?? "parse error"})`;
      if (distMissing && msg.ruleId && UNVERIFIED_RULES.includes(msg.ruleId)) unverified.push(line);
      else errors.push(line);
    }
  }
  return { errors, unverified, warnings };
}
