// Guards the semantics class: one h1 per page, no skipped heading level, one title that names the
// h1, labelled controls, hidden decorative glyphs, regions titled by headings. Reads the built
// pages in dist/ and runs the viewer's a11y-lint semantic rules over them; skips with a message
// when dist/ is missing. Source checks run without a build. Run with `node --test`.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { lintHtml } from "../../packages/viewer/src/a11y-lint.ts";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(site, "dist");

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() && e.name !== "_astro"
      ? pages(join(dir, e.name))
      : e.name.endsWith(".html")
        ? [join(dir, e.name)]
        : [],
  );
}

const RULES = new Set(["form-label", "labelledby-heading", "glyph-hidden", "badge-space"]);

describe(
  "built pages",
  { skip: existsSync(dist) ? false : "website/dist is missing, run the build" },
  () => {
    const files = existsSync(dist) ? pages(dist) : [];
    for (const file of files) {
      const name = relative(dist, file);
      it(name, () => {
        const html = readFileSync(file, "utf8");
        const problems = lintHtml(html)
          .filter((f) => RULES.has(f.rule))
          .map((f) => `${f.rule}: ${f.element + " " + f.message}`);
        const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;
        const heads = [...main.matchAll(/<h([1-6])[\s>][\s\S]*?<\/h\1>/g)].map((m) => Number(m[1]));
        const h1s = heads.filter((h) => h === 1).length;
        if (h1s !== 1) problems.push(`${h1s} h1 elements, expected 1`);
        heads.forEach((h, i) => {
          if (i > 0 && h > heads[i - 1] + 1)
            problems.push(`heading jumps from h${heads[i - 1]} to h${h}`);
        });
        assert.deepEqual(problems, [], `${name}\n${problems.join("\n")}`);
      });
    }
  },
);

describe("source", () => {
  const css = readFileSync(join(site, "src", "styles", "brand.css"), "utf8");
  it("gives every .docsx-btn and .docsx-copy an :active and a :disabled state", () => {
    for (const sel of [".docsx-btn", ".docsx-copy"]) {
      assert.ok(css.includes(`${sel}:active`), `${sel}:active missing`);
      assert.ok(css.includes(`${sel}:disabled`), `${sel}:disabled missing`);
    }
  });
  it("labels task-list checkboxes through the rehype plugin", () => {
    const cfg = readFileSync(join(site, "astro.config.mjs"), "utf8");
    assert.match(cfg, /rehypeLabelTaskList\]/);
  });
});
