// GFM task lists render a bare `<input type="checkbox" disabled>` beside the item text, which
// leaves the checkbox without a name. Give each one an aria-label taken from its list item text.
export default function rehypeLabelTaskList() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  if (node.type === "element" && node.tagName === "li") label(node);
  for (const child of node.children) walk(child);
}

function text(node) {
  if (node.type === "text") return node.value;
  if (node.type === "element" && node.tagName === "ul") return "";
  return (node.children ?? []).map(text).join("");
}

function label(li) {
  const box = (li.children ?? []).find(
    (c) => c.type === "element" && c.tagName === "input" && c.properties?.type === "checkbox",
  );
  if (!box || box.properties.ariaLabel) return;
  const name = text(li).replace(/\s+/g, " ").trim();
  if (name !== "") box.properties.ariaLabel = name;
}
