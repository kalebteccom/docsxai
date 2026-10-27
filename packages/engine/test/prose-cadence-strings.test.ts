// Guard for the prose-cadence class in product strings: filler words and contrast closers in
// string literals under packages/*/src. Code comments are not strings and never scanned.
// The same list lives in website/scripts/check-prose-cadence.test.mjs for Markdown and MDX.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");

const PATTERNS: RegExp[] = [
  /\bdelv(?:e|es|ed|ing)\b/i,
  /\brobust(?:ness|ly)?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bcomprehensive(?:ly)?\b/i,
  /\bcrucial(?:ly)?\b/i,
  /\bpivotal\b/i,
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\bjourneys?\b/i,
  /\bholistic(?:ally)?\b/i,
  /\bstreamlin(?:e|es|ed|ing)\b/i,
  /\bunlock(?:s|ed|ing)?\b/i,
  /\bnot just\b|\bnot merely\b|\bmore than just\b|\bsimply put\b/i,
  /\brather than\b/i,
  /\bisn't about\b|\bis not about\b/i,
  /\bworth noting\b|\bthat said\b|\bultimately\b|\bin short\b/i,
];

/** True false positives only: repo-relative file, a substring of the string, and why. */
const EXCEPTIONS: { file: string; text: string; reason: string }[] = [];

function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist") sources(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$|\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function findHits(): string[] {
  const hits: string[] = [];
  for (const pkg of readdirSync(join(root, "packages"))) {
    const src = join(root, "packages", pkg, "src");
    if (!statSync(join(root, "packages", pkg)).isDirectory()) continue;
    for (const file of sources(src)) {
      const rel = relative(root, file);
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          const text = node.text;
          const re = PATTERNS.find((p) => p.test(text));
          if (re && !EXCEPTIONS.some((x) => x.file === rel && text.includes(x.text))) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            hits.push(`${rel}:${line}: ${text.trim().slice(0, 100)}  [${re.source.slice(0, 24)}]`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return hits;
}

describe("prose cadence in product strings", () => {
  it("has no filler words or contrast closers in string literals", () => {
    expect(findHits()).toEqual([]);
  });

  it("keeps every exception reasoned and still in use", () => {
    for (const x of EXCEPTIONS) {
      expect(x.reason.length).toBeGreaterThan(10);
      expect(readFileSync(join(root, x.file), "utf8")).toContain(x.text);
    }
  });
});
