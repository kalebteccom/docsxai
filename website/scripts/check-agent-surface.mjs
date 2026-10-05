// Post-build check for the agent/end-user split. Fails the build unless:
//   - no rendered HTML page contains a "For agents" aside,
//   - every page whose source has a "For agents" aside keeps it in its .md twin,
//   - the agent-only pages emit a .md and no HTML.
// Runs after `astro build`, against dist/.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { agentOnlyPages } from "./doc-pipeline.mjs";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(site, "dist");
const content = join(site, "src", "content", "docs");

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
const ASIDE_HTML = /<aside[^>]*aria-label="For agents"/i;
const ASIDE_SRC = /^:::\w+\[For agents\]/m;

let htmlPages = 0;
for (const f of walk(dist)) {
  if (!f.endsWith(".html")) continue;
  htmlPages++;
  if (ASIDE_HTML.test(readFileSync(f, "utf8"))) {
    problems.push(`rendered HTML keeps a "For agents" aside: ${relative(dist, f)}`);
  }
}

let withAside = 0;
for (const f of walk(content)) {
  if (!/\.mdx?$/.test(f) || !ASIDE_SRC.test(readFileSync(f, "utf8"))) continue;
  withAside++;
  const slug = relative(content, f).replace(/\.mdx?$/, "");
  const twin = join(dist, `${slug}.md`);
  if (!existsSync(twin) || !ASIDE_SRC.test(readFileSync(twin, "utf8"))) {
    problems.push(`.md twin lost the "For agents" aside: ${slug}.md`);
  }
}

for (const p of agentOnlyPages) {
  const slug = p.out.replace(/\.mdx?$/, "");
  if (!existsSync(join(dist, `${slug}.md`))) problems.push(`agent page has no .md: ${slug}.md`);
  if (existsSync(join(dist, slug, "index.html")))
    problems.push(`agent page renders HTML: ${slug}/`);
}

if (problems.length > 0) {
  console.error(
    `check-agent-surface: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(
  `check-agent-surface: ok (${htmlPages} HTML pages clean, ${withAside} .md twins keep their asides, ${agentOnlyPages.length} agent pages .md-only).`,
);
