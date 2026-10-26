// Step prose comes from the doc pack and lands in an MDX page, and MDX runs `import`/`export`
// lines, `{expr}` and JSX attributes when Astro builds the site. `inertMdx` keeps the prose as
// Markdown and turns those three into plain text. It parses the prose with micromark (CommonMark
// with the constructs MDX turns off also turned off, so the block structure matches MDX), leaves
// fenced code and code spans byte-for-byte, and outside them backslash-escapes `{`, `}` and `<`
// and writes the first letter of a line-start `import`/`export` as a character reference.

import { parse, postprocess, preprocess } from "micromark";

/** The CommonMark constructs MDX disables (`micromark-extension-mdx-md`). */
const MDX_OFF = { disable: { null: ["autolink", "codeIndented", "htmlFlow", "htmlText"] } };

const PUNCT = /[!-/:-@[-`{-~]/;

/** Offsets [start, end) of the code the prose holds, as MDX will parse it. */
function codeRanges(md: string): Array<[number, number]> {
  const events = postprocess(
    parse({ extensions: [MDX_OFF] })
      .document()
      .write(preprocess()(md, undefined, true)),
  );
  const ranges: Array<[number, number]> = [];
  for (const [kind, token] of events) {
    if (kind !== "enter") continue;
    const start = token.start.offset;
    const end = token.end.offset;
    // A GFM table splits cells on `|` before it finds code spans, so a span holding `|` may not
    // be code on the built page. Escape its text like the rest.
    if (
      token.type === "codeFenced" ||
      (token.type === "codeText" && !md.slice(start, end).includes("|"))
    ) {
      ranges.push([start, end]);
    }
  }
  return ranges;
}

function inertText(text: string, lineStart: boolean): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const atLine = i === 0 ? lineStart : text[i - 1] === "\n";
    if (atLine) {
      const m = /^[ \t]*(import|export)\b/.exec(text.slice(i));
      if (m) {
        const lead = m[0].length - m[1]!.length;
        out += `${text.slice(i, i + lead)}&#${String(m[1]!.charCodeAt(0))};`;
        i += lead;
        continue;
      }
    }
    if (ch === "\\" && i + 1 < text.length && PUNCT.test(text[i + 1]!)) {
      out += ch + text[i + 1]!;
      i++;
    } else {
      out += ch === "{" || ch === "}" || ch === "<" ? `\\${ch}` : ch;
    }
  }
  return out;
}

/** `md` with every MDX `import`/`export`, expression and JSX tag made plain text. */
export function inertMdx(md: string): string {
  let out = "";
  let at = 0;
  for (const [start, end] of codeRanges(md)) {
    if (start < at) continue;
    out += inertText(md.slice(at, start), at === 0 || md[at - 1] === "\n");
    out += md.slice(start, end);
    at = end;
  }
  return out + inertText(md.slice(at), at === 0 || md[at - 1] === "\n");
}
