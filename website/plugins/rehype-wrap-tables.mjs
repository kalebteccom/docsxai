// Wrap each markdown table in a scroll container, and let wide tables stack on phones.
//
// Starlight makes a `<table>` itself `display: block; overflow: auto`, so a wide table scrolls
// inside the column but the scrolling element is the table, and giving that element
// `role="region"` would replace its table role. The wrapper becomes the scroller instead (see
// brand.css); Footer.astro's script makes it focusable and labelled only while it overflows.
//
// A table of STACK_COLUMNS or more columns gets the `docsx-table--stack` class: at phone width
// brand.css lays each row out as a card, the first cell as its title and every other cell under
// its column name, taken from `data-label`. CSS display changes drop table semantics in some
// browsers, so a stacked table carries explicit table, row and cell roles.
// A small hast walk, no extra dependency.
export const STACK_COLUMNS = 4;

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

const elements = (node) => (node?.children ?? []).filter((c) => c.type === "element");

function text(node) {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map(text).join("");
}

function rows(table) {
  return elements(table).flatMap((part) =>
    part.tagName === "tr" ? [part] : elements(part).filter((c) => c.tagName === "tr"),
  );
}

function set(node, key, value) {
  (node.properties ??= {})[key] = value;
}

function addClass(node, name) {
  const props = (node.properties ??= {});
  const list = Array.isArray(props.className) ? props.className : [];
  props.className = [...list, name];
}

function stack(table) {
  const all = rows(table);
  const head = all.find((tr) => elements(tr).some((c) => c.tagName === "th"));
  const labels = head ? elements(head).map((c) => text(c).trim()) : [];
  if (labels.length < STACK_COLUMNS) return;
  addClass(table, "docsx-table--stack");
  set(table, "role", "table");
  for (const part of elements(table)) {
    if (part.tagName === "thead" || part.tagName === "tbody") set(part, "role", "rowgroup");
  }
  for (const tr of all) {
    set(tr, "role", "row");
    elements(tr).forEach((cell, i) => {
      if (cell.tagName === "th") {
        set(cell, "role", "columnheader");
      } else {
        set(cell, "role", "cell");
        if (labels[i]) set(cell, "dataLabel", labels[i]);
      }
    });
  }
}

function wrap(table) {
  stack(table);
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["docsx-table-scroll"] },
    children: [table],
  };
}
