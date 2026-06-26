// Strip "For agents" asides from the rendered HTML.
//
// Agent-facing guidance is authored inline as a Starlight aside titled
// "For agents" (`:::caution[For agents]`). On the human-rendered site those
// asides are removed entirely; the same guidance is preserved verbatim in the
// page source and served from the plaintext .md endpoint (linked from
// llms.txt), so agents still get it while end users see a focused page.
//
// Starlight renders the aside as `<aside aria-label="For agents" ...>`, so the
// match is exact and independent of the aside variant (caution/note/tip). No
// unified/unist dependency - a small hast walk keeps the build's dependency
// surface unchanged.
export default function rehypeStripAgentAsides() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  node.children = node.children.filter((child) => !isAgentAside(child));
  for (const child of node.children) walk(child);
}

function isAgentAside(node) {
  if (node?.type !== "element" || node.tagName !== "aside") return false;
  const props = node.properties ?? {};
  const label = props.ariaLabel ?? props["aria-label"];
  return typeof label === "string" && label.trim().toLowerCase() === "for agents";
}
