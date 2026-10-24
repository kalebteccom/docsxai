// Checks plugins/remark-split-transcripts.mjs: the commands of a `$ ` transcript end up in `sh`
// blocks without prompts, the output in `text` blocks, and other code blocks are left alone.
// Run with `node --test` (the package's `test` script); no build needed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import remarkSplitTranscripts, { splitTranscript } from "../plugins/remark-split-transcripts.mjs";

const code = (value, lang = null, meta = null) => ({ type: "code", lang, meta, value });
const run = (children) => {
  const tree = { type: "root", children };
  remarkSplitTranscripts()(tree);
  return tree.children;
};

describe("splitTranscript", () => {
  it("separates one command from its output", () => {
    assert.deepEqual(splitTranscript("$ docsxai run .\nrun: ok\nrun: 1 of 1"), [
      { command: "docsxai run .", output: "run: ok\nrun: 1 of 1" },
    ]);
  });

  it("starts a new group at a prompt that follows output", () => {
    const groups = splitTranscript("$ docsxai lint .\n0 errors\n$ echo $?\n1");
    assert.deepEqual(groups, [
      { command: "docsxai lint .", output: "0 errors" },
      { command: "echo $?", output: "1" },
    ]);
  });

  it("keeps back-to-back commands in one group and drops blank lines between groups", () => {
    assert.deepEqual(splitTranscript("$ a\n$ b\nout\n\n$ c"), [
      { command: "a\nb", output: "out" },
      { command: "c", output: "" },
    ]);
  });

  it("follows a backslash continuation", () => {
    assert.deepEqual(splitTranscript("$ docsxai run . \\\n  --flow x\nok"), [
      { command: "docsxai run . \\\n  --flow x", output: "ok" },
    ]);
  });

  it("returns null when the first line is not a prompt", () => {
    assert.equal(splitTranscript("run: ok\n$ not a command"), null);
  });
});

describe("remarkSplitTranscripts", () => {
  it("replaces a transcript with sh and text blocks and no prompt", () => {
    const [sh, text] = run([code("$ docsxai doctor\nok: doctor")]);
    assert.deepEqual([sh.lang, sh.value], ["sh", "docsxai doctor"]);
    assert.deepEqual([text.lang, text.value], ["text", "ok: doctor"]);
  });

  it("leaves sh blocks, yaml blocks and unprompted text blocks alone", () => {
    const blocks = [code("$ docsxai run", "sh"), code("name: x", "yaml"), code("run: ok", "text")];
    assert.deepEqual(run(blocks), blocks);
  });

  it("reaches blocks nested in other nodes", () => {
    const [list] = run([
      { type: "list", children: [{ type: "listItem", children: [code("$ a\nb")] }] },
    ]);
    const kids = list.children[0].children;
    assert.deepEqual(
      kids.map((k) => k.lang),
      ["sh", "text"],
    );
  });
});
