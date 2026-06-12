// Style artifact — load/write/derive `docs/style.yaml` + derived `docs/style.json`, plus the
// jargon-leak scanner that backs the semantic-reshape exit criterion (testing-jargon absent
// from user-facing step write-ups). The engine never re-shapes prose itself (LLM-agnostic) —
// the agent does that during calibration. This module is the engine's contribution: validate
// the schema, persist the artifact, and report when jargon leaks through.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { StyleArtifact } from "./doc-pack.js";
import { resolveWorkspacePath } from "./workspace.js";

export class StyleError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StyleError";
  }
}

/** The seed style every workspace starts with — overwritable by the agent during calibration. */
export const DEFAULT_STYLE: StyleArtifact = {
  schema: "docsxai/style@1",
  voice: {
    tone: "concise, instructional, second-person ('you')",
    audience: "end users (not engineers)",
  },
  structure: { per_step: "one short imperative sentence + a screenshot; no internal jargon" },
  terminology: {},
  pruning_rules: [
    "VERIFY/EXPECT/ASSERT directives",
    "WAIT directives",
    "internal locator names",
    "network-verification blocks",
  ],
};

/**
 * Regex patterns keyed by the pruning-rule category string. The style artifact's `pruning_rules`
 * names categories from this catalogue; the lint reports any match.
 *
 * Each pattern is multiline-friendly. Add new categories here and reference them by string in
 * `style.yaml`'s `pruning_rules:` — the engine reads the array, picks the matching patterns,
 * and scans `docs/**\/*.md` for leaks.
 */
export const JARGON_PATTERNS: Record<string, RegExp> = {
  "VERIFY/EXPECT/ASSERT directives": /\b(VERIFY|EXPECT|ASSERT)\b/g,
  "WAIT directives": /\bWAIT(?:\s+FOR)?\b/g,
  "internal locator names":
    /\b(data-testid|data-test|data-cy|data-qa|querySelector|getByRole|getByText)\b/g,
  "network-verification blocks":
    /\b(GET|POST|PUT|DELETE|PATCH)\s+\/(?:api|v\d)\/\S+|\bstatus[:\s]+[1-5]\d{2}\b/g,
};

export interface JargonHit {
  /** Path of the offending file, workspace-relative. */
  file: string;
  /** 1-based line number where the match starts. */
  line: number;
  /** The pruning-rule category that matched. */
  category: string;
  /** The literal substring that matched. */
  snippet: string;
}

export interface StylePaths {
  workspace: string;
  yamlPath: string;
  jsonPath: string;
}

export function stylePathsFor(workspace: string): StylePaths {
  return {
    workspace,
    yamlPath: resolveWorkspacePath(workspace, "docs", "style.yaml"),
    jsonPath: resolveWorkspacePath(workspace, "docs", "style.json"),
  };
}

/** Read + parse + validate `docs/style.yaml`. Returns null when the file doesn't exist. Throws on invalid YAML or schema mismatch. */
export async function loadStyle(workspace: string): Promise<StyleArtifact | null> {
  const { yamlPath } = stylePathsFor(workspace);
  let text: string;
  try {
    text = await fs.readFile(yamlPath, "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new StyleError(`${yamlPath}: invalid YAML — ${(e as Error).message}`, e);
  }
  const parsed = StyleArtifact.safeParse(raw);
  if (!parsed.success) {
    throw new StyleError(
      `${yamlPath}: schema validation failed — ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** Write `docs/style.yaml` + derived `docs/style.json`. Creates `docs/` if missing. */
export async function writeStyle(workspace: string, style: StyleArtifact): Promise<StylePaths> {
  const paths = stylePathsFor(workspace);
  await fs.mkdir(path.dirname(paths.yamlPath), { recursive: true });
  await fs.writeFile(paths.yamlPath, stringifyYaml(style, { lineWidth: 100 }), "utf8");
  await fs.writeFile(paths.jsonPath, JSON.stringify(style, null, 2) + "\n", "utf8");
  return paths;
}

/** Init the style artifact with `DEFAULT_STYLE` if it doesn't already exist. */
export async function initStyleIfAbsent(
  workspace: string,
): Promise<{ paths: StylePaths; created: boolean }> {
  const paths = stylePathsFor(workspace);
  try {
    await fs.access(paths.yamlPath);
    return { paths, created: false };
  } catch {
    await writeStyle(workspace, DEFAULT_STYLE);
    return { paths, created: true };
  }
}

/** Scan a single text body against the named jargon categories. Returns hits with line numbers. */
export function scanTextForJargon(text: string, file: string, categories: string[]): JargonHit[] {
  const hits: JargonHit[] = [];
  const lines = text.split(/\n/);
  for (const category of categories) {
    const pattern = JARGON_PATTERNS[category];
    if (!pattern) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // reset stateful flag-`g` regex each pass
      const re = new RegExp(pattern.source, pattern.flags.replace(/g/g, "") + "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        hits.push({ file, line: i + 1, category, snippet: m[0] });
      }
    }
  }
  return hits;
}

/** Scan every `<workspace>/docs/<flow>/<step>.md` user-facing write-up for jargon leakage. */
export async function scanWorkspaceForJargon(
  workspace: string,
  style: StyleArtifact,
): Promise<JargonHit[]> {
  const docsRoot = resolveWorkspacePath(workspace, "docs");
  const flows = await fs.readdir(docsRoot, { withFileTypes: true }).catch(() => []);
  const categories = style.pruning_rules ?? [];
  if (categories.length === 0) return [];

  const hits: JargonHit[] = [];
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    const flowDir = resolveWorkspacePath(workspace, "docs", ent.name);
    const files = await fs.readdir(flowDir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const abs = resolveWorkspacePath(workspace, "docs", ent.name, f);
      const rel = path.relative(path.resolve(workspace), abs);
      const text = await fs.readFile(abs, "utf8").catch(() => "");
      hits.push(...scanTextForJargon(text, rel, categories));
    }
  }
  return hits;
}

export function formatJargonHitsText(hits: JargonHit[]): string {
  if (hits.length === 0) return "✓ no jargon leaks\n";
  let out = `${hits.length} jargon leak${hits.length !== 1 ? "s" : ""}:\n`;
  for (const h of hits) {
    out += `  ${h.file}:${h.line}  [${h.category}]  ${h.snippet}\n`;
  }
  return out;
}
