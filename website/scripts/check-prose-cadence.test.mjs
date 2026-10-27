// Guard for the prose-cadence class: filler words, "not just X", "rather than", "isn't about",
// "that said", "ultimately" and similar tells in user-visible prose.
// Scans the READMEs, docs/, the site's tracked content, llms.txt, the agent skills and the
// user-facing strings in package sources (code comments are skipped). Inline code spans are
// skipped. Dashes belong to scripts/prose-guard.mjs and are not checked here.
// Run with `node --test`; no build needed.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Word-bounded, case-insensitive. Each pattern has a plainer replacement. */
const PATTERNS = [
  /\bdelv(?:e|es|ed|ing)\b/i,
  /\brobust(?:ness|ly)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bcomprehensive(?:ly)?\b/i,
  /\bcrucial(?:ly)?\b/i,
  /\bpivotal\b/i,
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\brealms?\b(?!=)/i,
  /\bjourneys?\b/i,
  /\btestament\b/i,
  /\bdeep dive\b|\bdive deep\b/i,
  /\bholistic(?:ally)?\b/i,
  /\bstreamlin(?:e|es|ed|ing)\b/i,
  /\bsupercharg(?:e|es|ed|ing)\b/i,
  /\bgame-chang(?:er|ing)\b/i,
  /\bcutting-edge\b|\bworld-class\b|\bbest-in-class\b/i,
  /\bunlock(?:s|ed|ing)?\b/i,
  /\btapestry\b|\btreasure trove\b|\bharness the power\b/i,
  /\bin today's\b|\bwhen it comes to\b|\bat the end of the day\b|\bneedless to say\b/i,
  /\b(?:the|a|an) (?:evolving |changing |competitive )?landscape (?:of|for)\b/i,
  /\bnot just\b|\bnot merely\b/i,
  /\brather than\b/i,
  /\bisn't about\b|\bis not about\b/i,
  /\bworth noting\b|\bworth mentioning\b/i,
  /\bthat said\b|\bultimately\b|\bat its core\b|\bin short\b/i,
];

/** Entries here are true false positives only. `file` is repo-relative, `text` a substring of the line. */
const EXCEPTIONS = [];

const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".git", "archive"]);
const GENERATED = "AUTO-GENERATED from";

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

const isProse = (p) => /\.(md|mdx|txt)$/.test(p);
const isSource = (p) => /\.(ts|tsx|astro|mjs)$/.test(p) && !/\.test\.|\/test\//.test(p);

function files() {
  const out = [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "AGENTS.md",
    "CLAUDE.md",
    "website/public/llms.txt",
  ]
    .map((f) => join(root, f))
    .filter(existsSync);
  out.push(...walk(join(root, "docs"), isProse));
  out.push(...walk(join(root, "website", "src", "content"), isProse));
  out.push(...walk(join(root, "examples"), isProse));
  for (const pkg of readdirSync(join(root, "packages"))) {
    const dir = join(root, "packages", pkg);
    if (!statSync(dir).isDirectory()) continue;
    out.push(
      ...walk(dir, (p) => p.endsWith("README.md") || /SKILL\.md$|\/commands\/.*\.md$/.test(p)),
    );
    out.push(...walk(join(dir, "src"), isSource));
  }
  out.push(...walk(join(root, "website", "src", "components"), isSource));
  out.push(...walk(join(root, "website", "src", "pages"), isSource));
  return out;
}

/** Lines of user-visible text: no inline code, no code comments in source files. */
function* prose(file, text) {
  const source = isSource(file);
  let inBlockComment = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (source) {
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      const t = line.trim();
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) inBlockComment = true;
        continue;
      }
      if (t.startsWith("//") || t.startsWith("*")) continue;
      line = line.replace(/\s\/\/\s.*$/, "");
    }
    yield [i + 1, line.replace(/`[^`]*`/g, "")];
  }
}

describe("prose cadence", () => {
  it("has no filler words or contrast closers in user-visible prose", () => {
    const hits = [];
    for (const file of files()) {
      const text = readFileSync(file, "utf8");
      if (text.includes(GENERATED)) continue;
      const rel = relative(root, file);
      for (const [n, line] of prose(file, text)) {
        const pattern = PATTERNS.find((re) => re.test(line));
        if (!pattern) continue;
        if (EXCEPTIONS.some((x) => x.file === rel && line.includes(x.text))) continue;
        hits.push(`${rel}:${n}: ${line.trim().slice(0, 110)}  [${pattern.source.slice(0, 30)}]`);
      }
    }
    assert.deepEqual(hits, [], `rewrite these lines plainly:\n${hits.join("\n")}`);
  });

  it("keeps every exception reasoned and still in use", () => {
    for (const x of EXCEPTIONS) {
      assert.ok(x.reason && x.reason.length > 10, `${x.file}: exception needs a reason`);
      const p = join(root, x.file);
      assert.ok(
        existsSync(p) && readFileSync(p, "utf8").includes(x.text),
        `${x.file}: stale exception`,
      );
    }
  });
});
