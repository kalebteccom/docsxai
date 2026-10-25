// Flags such as `--flow` and `--fail-on` must reach the page as two hyphens. The Markdown
// processor's smart punctuation turned `--` into an em dash, so the landing hero showed
// `—flow`. Checks the site config, the rendered output of the configured processor, and the
// built HTML when `pnpm build` has run. No browser needed.
// Run with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: config } = await import("../astro.config.mjs");

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
