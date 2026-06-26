// Shared doc-porting pipeline. Two consumers import from here:
//
//   - sync-docs.mjs      generates the published Starlight pages (HTML twin)
//                        from the canonical sources into the content collection.
//   - src/pages/[...slug].md.ts  serves the plaintext .md twin of every page
//                        (linked from llms.txt) and the agent-only pages, which
//                        have no HTML rendering at all.
//
// The transform converts em/en dashes to the spaced-hyphen house style (outside
// code), drops the duplicate H1, and rewrites internal markdown links to the
// site IA (or to GitHub for sources that don't publish).
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const GITHUB = "https://github.com/kalebteccom/docsxai";

// Pages rendered as HTML on the site (and mirrored as a plaintext .md twin).
// Each entry: src (repo-relative source), out (content-collection path),
// title/description (frontmatter), optional strikeLines (drop any line matching
// one of these RegExps) and replace ([pattern, replacement] pairs, applied
// before dash conversion and link rewriting).
export const htmlPages = [
  {
    src: "docs/running-against-an-app-repo.md",
    out: "guides/running-against-an-app-repo.md",
    title: "Running against an app repo",
    description:
      "The conceptual overview of documenting an app that's built and served from a local repo, without leaving a trace: throwaway worktree, separate workspace, deterministic replay.",
    replace: [
      [/— see\n`docs\/archive\/phase-plans\/PHASE-0\.md`; until then,/, "- until then,"],
      [/ \(`docs\/archive\/phase-plans\/PHASE-0\.md` "plugin packaging prototype"\)/, ""],
    ],
  },
  {
    src: "docs/ci-recipes.md",
    out: "guides/ci-recipes.md",
    title: "CI recipes",
    description:
      "Deterministic doc refresh in your pipeline: GitHub Actions and generic CI examples for driving docsxai run with cached auth and uploaded doc packs.",
  },
  {
    src: "docs/security-best-practices-for-adopters.md",
    out: "guides/security-best-practices.md",
    title: "Security best practices",
    description:
      "Operational hardening for teams integrating docsxai: install discipline, credential handling, workspace containment, and plugin trust posture.",
  },
  {
    src: "docs/actionability-contract.md",
    out: "reference/actionability.md",
    title: "Actionability contract",
    description:
      "The portable element-state vocabulary returned by BrowserDriver.actionable(selector), mirrored by browxai's find(), so a calibration agent knows at write-time whether a selector can be acted on.",
  },
  {
    src: "packages/engine/README.md",
    out: "packages/engine.md",
    title: "@docsxai/engine",
    description:
      "LLM-agnostic engine: flow-file parser + deterministic runtime, calibration helpers, target-site auth strategies, and the full docsxai CLI.",
  },
  {
    src: "packages/plugin/README.md",
    out: "packages/plugin.md",
    title: "@docsxai/plugin",
    description:
      "Claude Code plugin - the first-class invocation surface. Calibration skills plus deterministic commands over the docsxai engine.",
  },
  {
    src: "packages/mcp/README.md",
    out: "packages/mcp.md",
    title: "@docsxai/mcp",
    description:
      "Standalone stdio MCP server over the docsxai engine: calibration meta-orchestration plus read-only doc-pack introspection for any MCP-speaking host.",
    replace: [
      [
        /\nAdding a tool\? Follow the numbered checklist in\n\[`docs\/ai-context\/tool-registration\/mcp-tool-registry\.md`\]\(\.\.\/\.\.\/docs\/ai-context\/tool-registration\/mcp-tool-registry\.md\)\.\n/,
        "\n",
      ],
      [/ The package is\n`private: true` until the go-public flip\./, ""],
    ],
  },
  {
    src: "packages/backend/README.md",
    out: "packages/backend.md",
    title: "@docsxai/backend",
    description:
      "Authenticated service that persists doc packs: projects, revisions, flow-files, screenshots, annotations, style artifacts, run history. REST + OAuth 2.1.",
  },
  {
    src: "packages/viewer/README.md",
    out: "packages/viewer.md",
    title: "@docsxai/viewer",
    description:
      "Static-HTML interactive viewer, burned-annotation renderer, and Starlight docs-site emitter for doc packs.",
  },
  {
    src: "packages/skill/README.md",
    out: "packages/skill.md",
    title: "@docsxai/skill",
    description:
      "Optional colocated .claude/skills/ fallback that delegates to the installed plugin, for teams that want to vendor and version-pin in the consumer repo.",
  },
  {
    src: "packages/plugin-confluence/README.md",
    out: "packages/plugin-confluence.md",
    title: "@docsxai/plugin-confluence",
    description:
      "Publisher plugin for Confluence Cloud: pushes the engine's ADF doc-pack projection through the REST v2 API, idempotently.",
    replace: [[/\n*$/, "\n\nRepo-only today; npm publication is decided at the public flip.\n"]],
  },
  {
    src: "packages/plugin-starlight/README.md",
    out: "packages/plugin-starlight.md",
    title: "@docsxai/plugin-starlight",
    description:
      "Renderer plugin that emits a production Astro Starlight docs site from a doc pack, wrapping the viewer's Starlight emitter and builder.",
    replace: [[/\n*$/, "\n\nRepo-only today; npm publication is decided at the public flip.\n"]],
  },
  {
    src: "CHANGELOG.md",
    out: "project/changelog.md",
    title: "Changelog",
    description: "All notable changes to docsxai, release by release.",
  },
  {
    src: "CONTRIBUTING.md",
    out: "project/contributing.md",
    title: "Contributing",
    description:
      "How to contribute to docsxai: dev setup, the quality gate, commit conventions, and what makes a change land.",
  },
  {
    src: "SECURITY.md",
    out: "project/security.md",
    title: "Security policy",
    description:
      "docsxai's threat surface, hardening posture, supported versions, and how to report a vulnerability.",
  },
];

// Agent-facing pages. These never render as HTML and are not in the human
// sidebar - they are served only as plaintext .md (linked from llms.txt) so a
// coding agent driving docsxai gets the full runbook and footgun map, while the
// rendered site stays focused on the end user.
export const agentOnlyPages = [
  {
    src: "docs/agent-runbook.md",
    out: "guides/agent-runbook.md",
    title: "Agent runbook",
    description:
      "Hand this to a coding agent: set up and run docsxai against a running web app without modifying its repo - workspace layout, auth capture, halts, and the iteration loop.",
  },
  {
    src: "docs/agent-guidance.md",
    out: "guides/agent-guidance.md",
    title: "Agent guidance",
    description:
      "The reach-for-this-not-that map for agents driving docsxai: ten temptations, why each bites, and the right call with a copyable example.",
  },
];

// Published routes, keyed by repo-relative source path. Only HTML pages get a
// site route; links to agent-only pages and other non-published sources fall
// through to GitHub. Package READMEs are also reachable via their directory.
export const ROUTES = new Map();
for (const p of htmlPages) {
  const route = `/${p.out.replace(/\.mdx?$/, "")}/`;
  ROUTES.set(p.src, route);
  const dirReadme = p.src.match(/^(packages\/[^/]+)\/README\.md$/);
  if (dirReadme) ROUTES.set(dirReadme[1], route);
}

/** Convert em/en dashes to spaced hyphens, skipping fenced code blocks. */
export function convertDashes(text) {
  let inFence = false;
  return text
    .split("\n")
    .map((raw) => {
      if (/^\s*(```+|~~~+)/.test(raw)) {
        inFence = !inFence;
        return raw;
      }
      if (inFence) return raw;
      return raw.replace(/ ?— ?/g, " - ").replace(/ – /g, " - ").replace(/–/g, "-");
    })
    .join("\n");
}

/**
 * Rewrite relative markdown links for a page generated from `src`. Targets are
 * resolved against the source file's directory to a repo-relative path; sources
 * that publish map to their site route, everything else points at GitHub
 * (trailing slash or extensionless directory -> tree, file -> blob).
 */
export function rewriteLinks(text, src) {
  const srcDir = posix.dirname(src);
  return text.replace(/\]\(([^()\s]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#|\/)/.test(target)) return whole;
    const [path, frag] = target.split("#");
    const resolved = posix.normalize(posix.join(srcDir, path)).replace(/\/$/, "");
    const suffix = frag ? `#${frag}` : "";
    const route = ROUTES.get(resolved);
    if (route) return `](${route}${suffix})`;
    const kind = path.endsWith("/") ? "tree" : "blob";
    return `](${GITHUB}/${kind}/main/${resolved}${suffix})`;
  });
}

export const q = (s) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * Apply the full transform pipeline to raw source text, returning the page body
 * (no frontmatter, no banner). H1 is dropped - the title comes from frontmatter
 * (HTML) or is prepended by the .md endpoint. Pure (no file IO) so the .md
 * endpoint can call it on text it read itself at build time.
 */
export function transformText(src, text, { strikeLines = [], replace = [] } = {}) {
  if (strikeLines.length > 0) {
    text = text
      .split("\n")
      .filter((line) => !strikeLines.some((re) => re.test(line)))
      .join("\n");
  }
  for (const [re, to] of replace) text = text.replace(re, to);
  text = convertDashes(text);
  text = rewriteLinks(text, src);
  text = text.replace(/^#\s+.*\n+/, ""); // drop the H1
  return text.trimStart();
}

/** Read a source file (resolved against the repo root) and transform it. */
export function transformBody(page) {
  return transformText(page.src, readFileSync(join(ROOT, page.src), "utf8"), page);
}
