// Wrap each markdown table in a scroll container.
//
// Starlight makes a `<table>` itself `display: block; overflow: auto`, so a wide table scrolls
// inside the column but the scrolling element is the table, and giving that element
// `role="region"` would replace its table role. The wrapper becomes the scroller instead (see
// brand.css); Footer.astro's script makes it focusable and labelled only while it overflows.
// A small hast walk, no extra dependency.
export default function rehypeWrapTables() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  node.children = node.children.map((child) => {
    walk(child);
    return isTable(child) ? wrap(child) : child;
  });
}

function isTable(node) {
  return node?.type === "element" && node.tagName === "table";
}

function wrap(table) {
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["docsx-table-scroll"] },
    children: [table],
  };
}
