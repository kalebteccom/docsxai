// Plaintext .md twin of every doc page, plus the agent-only pages.
//
// llms.txt links here (e.g. /reference/cli.md) so agents read clean markdown,
// including the "For agents" guidance that the rehype strip removes from the
// rendered HTML. Internal links are rewritten to their .md form so the whole
// agent-facing surface stays self-consistent.
//
// Agent-only pages (agent-runbook, agent-guidance) exist ONLY here - they have
// no HTML rendering and are absent from the human sidebar.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GITHUB, agentOnlyPages, transformText } from "../../scripts/doc-pipeline.mjs";

// At build time the working directory is the website package; the repo root is
// its parent. Resolving from cwd (not import.meta.url) keeps reads correct when
// Astro bundles this endpoint for prerendering.
const REPO_ROOT = join(process.cwd(), "..");

// Pages that are not part of the markdown surface.
const SKIP = new Set(["index", "404"]);

type PageProps = { title: string; body: string };

export const getStaticPaths = (async () => {
  const docs = await getCollection("docs");
  const fromHtml = docs
    .map((e) => ({ ...e, slug: e.id.replace(/\.(md|mdx)$/, "") }))
    .filter((e) => !SKIP.has(e.slug))
    .map((e) => ({
      params: { slug: e.slug },
      props: { title: e.data.title, body: e.body ?? "" },
    }));
  const agentOnly = agentOnlyPages.map((p) => {
    const raw = readFileSync(join(REPO_ROOT, p.src), "utf8");
    return {
      params: { slug: p.out.replace(/\.mdx?$/, "") },
      props: {
        title: p.title,
        body: transformText(p.src, raw, { ...p, markdownSurface: true }),
      },
    };
  });
  return [...fromHtml, ...agentOnly];
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const { title, body } = props as PageProps;
  const md = `# ${title}\n\n${toMarkdownLinks(stripBanner(stripFrontmatter(body))).trim()}\n`;
  return new Response(md, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};

/** Drop a leading YAML frontmatter block, if present (entry.body has none). */
function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

/** Drop the sync-docs auto-generated banner comment. */
function stripBanner(text: string): string {
  return text.replace(/<!-- AUTO-GENERATED[\s\S]*?-->\n*/, "");
}

/**
 * Rewrite site-internal page links (trailing-slash routes) to their .md twin,
 * so links between agent-facing markdown files stay in the markdown surface.
 * Leaves anchors, asset paths (no trailing slash), and external links alone.
 */
function toMarkdownLinks(text: string): string {
  return rewriteAgentPageLinks(text).replace(
    /\]\((\/[^)#\s]+?)\/(#[^)\s]*)?\)/g,
    (_m, path, frag) => `](${path}.md${frag ?? ""})`,
  );
}

/**
 * Hand-written pages link to the agent-only docs on GitHub, since the rendered
 * site has no HTML for them. On the markdown surface those links resolve to the
 * .md endpoint instead.
 */
function rewriteAgentPageLinks(text: string): string {
  let out = text;
  for (const p of agentOnlyPages) {
    out = out.split(`](${GITHUB}/blob/main/${p.src}`).join(`](/${p.out}`);
  }
  return out;
}
