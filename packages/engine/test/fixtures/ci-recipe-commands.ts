// Shell-line extraction shared by the CI recipe suites: finds the `docsxai` commands inside the
// run / script / commands values of a parsed pipeline file.

/** Shell lines of a script value, with `\` continuations joined and comments and blanks dropped. */
export function shellLines(script: string): string[] {
  const out: string[] = [];
  let pending = "";
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    if (pending === "" && (line === "" || line.startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      pending += line.slice(0, -1).trim() + " ";
      continue;
    }
    out.push((pending + line).trim());
    pending = "";
  }
  return out;
}

const SCRIPT_KEYS = new Set(["run", "script", "before_script", "after_script", "commands"]);

/** Every shell line found under a run / script / commands key anywhere in a parsed YAML document. */
export function scriptsIn(node: unknown, inScript = false): string[] {
  if (typeof node === "string") return inScript ? shellLines(node) : [];
  if (Array.isArray(node)) return node.flatMap((n) => scriptsIn(n, inScript));
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => scriptsIn(v, SCRIPT_KEYS.has(k)));
  }
  return [];
}

/** The `docsxai` commands among shell lines, cut at the first pipe, redirect or `;`. */
export function docsxaiCommands(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/^\$\s+/, ""))
    .filter((l) => /^docsxai\s/.test(l))
    .map((l) => l.split(/\s*(?:\|\||\||>|;|&&)\s*/)[0]!.trim());
}
