// Names the viewer turns into paths and links: a step id becomes `screenshots/<id>.png` and
// `<id>.md`, a flow name becomes a directory and an `href`. Both come from files in the doc pack,
// so a value like `../../x` would read or copy files outside the pack and `javascript:...` would
// become a link target. Leaf: no imports.

function hasControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

function plainName(s: string): boolean {
  return s !== "" && !s.includes("\\") && !s.includes("..") && !s.includes(":") && !hasControl(s);
}

/** A step id that is one plain file-name part: no `/`, `\`, `..`, `:` or control character. */
export function isSafeStepId(id: string): boolean {
  return plainName(id) && !id.includes("/");
}

/** A flow name: `<flow>` or `<flow>/<variant>`, each part a plain name that is not `.`. */
export function isSafeFlowName(flow: string): boolean {
  const parts = flow.split("/");
  return parts.length <= 2 && parts.every((p) => p !== "." && plainName(p));
}

/** `name` quoted for a warning line, with control characters shown as escapes. */
export function showName(name: string): string {
  let out = "";
  for (const ch of JSON.stringify(name)) {
    const c = ch.codePointAt(0)!;
    out += c >= 0x7f && c <= 0x9f ? `\\u${c.toString(16).padStart(4, "0")}` : ch;
  }
  return out;
}
