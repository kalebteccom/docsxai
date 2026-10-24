// Split shell transcripts so a copy button copies the commands and nothing else.
//
// Reference pages show a command and its output in one fenced block, with `$ ` before each
// command. Expressive Code's copy button copies the whole block, prompts and output included,
// which does not run when pasted. This plugin rewrites a block whose first line starts with `$ `
// (no language, `text` or `console`) into a `sh` block per run of commands, without the prompts,
// each followed by a `text` block with its output. The Markdown source keeps the `$ ` convention,
// and the plaintext `.md` twin served for agents is built from that source, so it is unchanged.
// A small mdast walk, no extra dependency.

const TRANSCRIPT_LANGS = new Set(["", "text", "console"]);
const PROMPT = /^\$ (.*)$/;

/**
 * Split a transcript into `{ command, output }` groups, or return null when the first line is not
 * a prompt line. A command line ending in a backslash continues on the next line. A group ends at
 * the first prompt line after output, so `$ a`, `$ b` and then output stay one group.
 */
export function splitTranscript(value) {
  const lines = value.split("\n");
  if (!PROMPT.test(lines[0] ?? "")) return null;
  const groups = [];
  let current = null;
  let continued = false;
  for (const line of lines) {
    if (continued) {
      current.commands.push(line);
      continued = line.endsWith("\\");
      continue;
    }
    const prompt = PROMPT.exec(line);
    if (prompt) {
      if (current === null || current.output.length > 0) {
        current = { commands: [], output: [] };
        groups.push(current);
      }
      current.commands.push(prompt[1]);
      continued = prompt[1].endsWith("\\");
    } else if (current !== null) {
      current.output.push(line);
    }
  }
  return groups.map((g) => ({
    command: g.commands.join("\n"),
    output: g.output.join("\n").replace(/^\n+|\n+$/g, ""),
  }));
}

function blocksFor(node) {
  const groups = splitTranscript(node.value);
  if (groups === null) return null;
  const out = [];
  groups.forEach((g, i) => {
    const meta = i === 0 ? (node.meta ?? null) : null;
    out.push({ type: "code", lang: "sh", meta, value: g.command });
    if (g.output !== "") out.push({ type: "code", lang: "text", meta: null, value: g.output });
  });
  return out;
}

function isTranscript(node) {
  return node.type === "code" && TRANSCRIPT_LANGS.has(node.lang ?? "");
}

function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  const next = [];
  for (const child of node.children) {
    const split = isTranscript(child) ? blocksFor(child) : null;
    if (split === null) {
      walk(child);
      next.push(child);
    } else {
      next.push(...split);
    }
  }
  node.children = next;
}

export default function remarkSplitTranscripts() {
  return (tree) => walk(tree);
}
