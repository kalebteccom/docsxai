#!/usr/bin/env node
// leak-guard: keep repo-internal references out of the published site.
//
// Fails the build if any page under src/content/docs (generated or authored)
// contains a pointer that must never ship publicly:
//
//   - links into docs/ai-context or docs/archive (relative or via a GitHub
//     blob/tree URL) - those trees are internal working docs;
//   - any mention of the private project-ideas portfolio repo;
//   - absolute /Users/ paths (a leaked local filesystem path);
//   - client-engagement codenames. The codename regexes are assembled from
//     string fragments so this guard's own source never trips a scanner
//     looking for the same strings.
//
// Scans every line, code blocks included - a leak inside a fence is still a
// leak. Runs in `build` right after sync-docs, before prose-guard and astro.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const contentRoot = join(here, "..", "src", "content", "docs");

const CHECKS = [
  { kind: "link to internal docs tree", re: /\]\([^)]*docs\/(ai-context|archive)/ },
  {
    kind: "GitHub URL into internal docs tree",
    re: /github\.com\/kalebteccom\/docsxai\/(blob|tree)\/[^\s)]*docs\/(ai-context|archive)/,
  },
  { kind: "private portfolio repo reference", re: new RegExp("project" + "-ideas", "i") },
  { kind: "absolute /Users/ path", re: /\/Users\// },
  { kind: "client codename", re: new RegExp("cl" + "ipro", "i") },
  { kind: "client codename", re: new RegExp("web" + "wright", "i") },
];

/** Walk a directory tree and yield every markdown/mdx file. */
async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.(md|mdx)$/.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];

for await (const file of walk(contentRoot)) {
  const text = await readFile(file, "utf8");
  const rel = relative(join(here, "..", ".."), file);
  text.split("\n").forEach((line, i) => {
    for (const { kind, re } of CHECKS) {
      if (re.test(line)) {
        violations.push({ rel, line: i + 1, kind, text: line.trim() });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`\nleak-guard: ${violations.length} issue(s) found.\n`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  ${v.kind}`);
    console.error(`    ${v.text.slice(0, 100)}`);
  }
  console.error(
    "\nFix: strike or rewrite the offending line in the canonical source (or the sync manifest's strike/replace rules), not in the generated file.\n",
  );
  process.exit(1);
}

console.log("leak-guard: clean.");
