// Flags such as `--flow` and `--fail-on` must reach the page as two hyphens. The Markdown
// processor's smart punctuation turned `--` into an em dash, so the landing hero showed
// `—flow`. Checks the site config, the rendered output of the configured processor, and the
// built HTML when `pnpm build` has run. No browser needed.
// Run with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: config } = await import("../astro.config.mjs");

const repo = join(site, "..");

/**
 * Source files where an em dash (U+2014) or an en dash (U+2013) fails the test: every Markdown
 * and MDX file in the repo plus the plain-text agent index. Generated site pages are skipped
 * (they carry an AUTO-GENERATED banner and come from these sources). Fenced code blocks are
 * exempt: they hold sample code and real CLI output.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".astro", ".turbo", "coverage"]);
const COPY_FILE = /\.(md|mdx)$/;
const EXTRA_FILES = ["website/public/llms.txt"];

/**
 * Entries that may keep a dash. Each needs a reason. Keep this list short.
 * `path` is repo-relative with forward slashes; `lines` limits the entry to those line numbers.
 */
const EXCEPTIONS = [];

function copyFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) copyFiles(p, out);
    else if (COPY_FILE.test(e.name)) out.push(p);
  }
  return out;
}

/** Lines with a dash outside fenced code blocks, as `path:line: text`. */
export function dashFindings(file, text) {
  const rel = relative(repo, file).split(sep).join("/");
  if (text.includes("AUTO-GENERATED from")) return [];
  const skip = EXCEPTIONS.filter((x) => x.path === rel);
  const found = [];
  let fence = null;
  text.split("\n").forEach((line, i) => {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return;
    }
    if (fence || !/[\u2013\u2014]/.test(line)) return;
    if (skip.some((x) => !x.lines || x.lines.includes(i + 1))) return;
    found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  return found;
}

describe("no em or en dashes in docs and site copy", () => {
  it("keeps every exception justified", () => {
    for (const x of EXCEPTIONS) assert.ok(x.path && x.reason, JSON.stringify(x));
  });

  it("flags a dash outside a code fence and ignores one inside", () => {
    const text = "Fine.\n\n```\na \u2014 b\n```\n\nBad \u2014 here.\n";
    assert.equal(dashFindings(join(repo, "x.md"), text).length, 1);
  });

  it("finds none in any Markdown or MDX file outside fenced code blocks", () => {
    const files = [...copyFiles(repo), ...EXTRA_FILES.map((f) => join(repo, f))].filter((f) =>
      existsSync(f),
    );
    const bad = files.flatMap((f) => dashFindings(f, readFileSync(f, "utf8")));
    assert.deepEqual(bad, [], `Rewrite these with a comma, colon or full stop:\n${bad.join("\n")}`);
  });
});

/** A flag-like token after a space or an opening bracket: an em dash glued to a lowercase word. */
const BROKEN_FLAG = /[\s(>]—[a-z]/;

function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (p.endsWith(".html")) out.push(p);
  }
  return out;
}

describe("flags keep their two hyphens", () => {
  it("turns smart punctuation off for the site's Markdown processor", () => {
    const processor = config.markdown?.processor;
    assert.equal(processor?.name, "unified");
    assert.equal(processor.options.smartypants, false);
  });

  it("renders `--flag` text as typed, in prose and in a transcript line", async () => {
    const md = await createMarkdownProcessor({
      smartypants: config.markdown.processor.options.smartypants,
    });
    const { code } = await md.render(
      "Run docsxai diff . --fail-on warn --flow x -- done.\n\n# docsxai run . --flow publish-post\n",
    );
    assert.match(code, /--fail-on warn --flow x -- done/);
    assert.match(code, /--flow publish-post/);
    assert.doesNotMatch(code, /—|–/);
  });

  it("keeps the landing hero source on `--`", () => {
    const src = readFileSync(join(site, "src", "content", "docs", "index.mdx"), "utf8");
    assert.match(src, /docsxai run \. --flow publish-post/);
    assert.match(src, /docsxai diff \. --fail-on warn/);
  });

  const dist = join(site, "dist");
  it(
    "leaves no em dash glued to a lowercase word in built pages",
    { skip: !existsSync(dist) },
    () => {
      const bad = [];
      for (const file of htmlFiles(dist)) {
        const m = readFileSync(file, "utf8").match(
          new RegExp(`.{0,30}${BROKEN_FLAG.source}.{0,20}`),
        );
        if (m) bad.push(`${file.slice(dist.length)}: ${m[0]}`);
      }
      assert.deepEqual(bad, []);
    },
  );
});
