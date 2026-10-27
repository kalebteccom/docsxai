// Guard: no em dash (U+2014) in anything a user can read that ships from code. Source files are
// parsed with the TypeScript parser and every string literal, template chunk and JSX text is
// checked after unescaping, so an escaped u2014 counts too. Comments are not parsed and may keep the
// character. Covers the CLI, MCP, viewer and plugin sources (including the site files the viewer
// emits, which are template literals), website components and config, build scripts, the lint
// config, package descriptions, and the plugin's skill and command text. docs/*.md and website
// content pages have their own guard (scripts/prose-guard.mjs).

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const EM_DASH = "\u2014";

/** Files where a literal em dash is the point, with the reason and the exact count. */
const EXCEPTIONS: Readonly<Record<string, { count: number; reason: string }>> = {
  "scripts/prose-guard.mjs": {
    count: 2,
    reason:
      "the docs guard's own detector: it searches for the character and names it in its report",
  },
};

// --- file walking ----------------------------------------------------------------------------

function walk(dir: string, keep: (rel: string) => boolean, recursive = true): string[] {
  const abs = path.join(repo, dir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true, recursive });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(repo, path.join(e.parentPath, e.name)))
    .filter((rel) => !/(^|\/)(node_modules|dist|\.astro|coverage)\//.test(rel) && keep(rel))
    .sort();
}

const CODE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const notTest = (rel: string): boolean => !/\.(?:test|spec)\./.test(rel);

const packageDirs = readdirSync(path.join(repo, "packages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `packages/${e.name}`);

const CODE_FILES: string[] = [
  ...packageDirs.flatMap((p) => walk(`${p}/src`, (f) => CODE.test(f) && notTest(f))),
  ...packageDirs.flatMap((p) => walk(p, (f) => CODE.test(f) && notTest(f), false)),
  ...walk("scripts", (f) => CODE.test(f) && notTest(f)),
  ...walk("website/scripts", (f) => CODE.test(f) && notTest(f)),
  ...walk("website/src", (f) => CODE.test(f) && notTest(f)),
  "website/astro.config.mjs",
  "eslint.config.js",
];

/** Files where the whole text is user-visible, comments included. */
const WHOLE_TEXT_FILES: string[] = [
  ...walk("website/src", (f) => f.endsWith(".astro") || f.endsWith(".css")),
  ...walk("packages/plugin/skills", (f) => f.endsWith(".md")),
  ...walk("packages/plugin/commands", (f) => f.endsWith(".md")),
  ...walk("packages/skill/skill", (f) => f.endsWith(".md")),
  ...walk("packages/plugin/.claude-plugin", (f) => f.endsWith(".json")),
  "package.json",
  ...packageDirs.map((p) => `${p}/package.json`),
];

// --- matcher ---------------------------------------------------------------------------------

/** One `line: text` entry per string literal, template chunk or JSX text holding an em dash. */
export function emDashStrings(src: string, fileName = "x.ts"): string[] {
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.(?:ts|mts|cts)$/.test(fileName)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const check = (n: ts.Node, text: string): void => {
    if (!text.includes(EM_DASH)) return;
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    for (let i = 0; i < text.split(EM_DASH).length - 1; i++) {
      out.push(`${line + 1}: ${JSON.stringify(text.slice(0, 80))}`);
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) check(n, n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      check(n, n.text);
    else if (ts.isJsxText(n)) check(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function wholeTextHits(text: string): string[] {
  return text
    .split("\n")
    .flatMap((l, i) => (l.includes(EM_DASH) ? [`${i + 1}: ${l.trim().slice(0, 80)}`] : []));
}

function scan(files: string[], hitsOf: (rel: string, text: string) => string[]): string[] {
  const seen = new Map<string, number>();
  const found = files.flatMap((rel) => {
    const hits = hitsOf(rel, readFileSync(path.join(repo, rel), "utf8"));
    seen.set(rel, hits.length);
    const allowed = EXCEPTIONS[rel];
    if (allowed && hits.length === allowed.count) return [];
    return hits.map((h) => `${rel}:${h}`);
  });
  const stale = Object.keys(EXCEPTIONS)
    .filter((rel) => files.includes(rel) && seen.get(rel) !== EXCEPTIONS[rel]!.count)
    .map((rel) => `${rel}: exception expects ${EXCEPTIONS[rel]!.count}, found ${seen.get(rel)}`);
  return [...found, ...stale];
}

// --- tests -----------------------------------------------------------------------------------

describe("no em dash in user-visible strings", () => {
  it("source strings, emitted templates and scripts hold none", () => {
    expect(CODE_FILES.length).toBeGreaterThan(100);
    expect(scan(CODE_FILES, (rel, text) => emDashStrings(text, rel))).toEqual([]);
  });

  it("astro, css, skills, commands and package metadata hold none anywhere", () => {
    expect(WHOLE_TEXT_FILES.length).toBeGreaterThan(15);
    expect(scan(WHOLE_TEXT_FILES, (_rel, text) => wholeTextHits(text))).toEqual([]);
  });

  it("every exception names a file that exists and carries a reason", () => {
    for (const [rel, e] of Object.entries(EXCEPTIONS)) {
      expect(CODE_FILES.includes(rel), rel).toBe(true);
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("em dash matcher", () => {
  it("finds a dash in strings, template chunks, JSX text and an escaped literal", () => {
    const src = [
      `const a = "one ${EM_DASH} two";`,
      "const b = `x ${y} z " + EM_DASH + " w`;",
      'const c = "esc \\u2014 aped";',
      `const d = <p>jsx ${EM_DASH} text</p>;`,
    ].join("\n");
    expect(emDashStrings(src, "x.tsx").map((h) => h.split(":")[0])).toEqual(["1", "2", "3", "4"]);
  });

  it("ignores comments and clean strings", () => {
    const src = `// a ${EM_DASH} b\n/* c ${EM_DASH} d */\nconst a = "fine, plain";\n`;
    expect(emDashStrings(src)).toEqual([]);
  });
});
