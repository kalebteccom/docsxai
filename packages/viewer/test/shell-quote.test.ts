import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { recaptureCommand, shellQuote, SHELL_QUOTE_SRC } from "../src/shell-quote.js";
import { stepHtml } from "../src/viewer-markup.js";
import { annotatedShotAstro } from "../src/starlight-components.js";
import { uiStrings } from "../src/ui-strings.js";

const NAMES = [
  "plain-name_1.2",
  "has space",
  "it's",
  'say "hi"',
  "$HOME `id` $(id)",
  "a;b|c&d",
  "",
  "é ñ",
  "-x",
];

const viaShell = (word: string) =>
  execFileSync("sh", ["-c", `printf %s ${word}`], { encoding: "utf8" });

describe("shellQuote", () => {
  it("leaves a plain name bare", () => {
    expect(shellQuote("open-sidebar")).toBe("open-sidebar");
    expect(shellQuote("checkout/v2")).toBe("checkout/v2");
  });

  it("single-quotes names with spaces and escapes embedded single quotes", () => {
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("")).toBe("''");
  });

  it.each(NAMES)("round-trips %j through sh as one word", (name) => {
    expect(viaShell(shellQuote(name))).toBe(name);
  });

  it("the source emitted into the Astro component behaves the same", () => {
    const fn = runInNewContext(`${SHELL_QUOTE_SRC}; shellQuote;`) as (s: string) => string;
    for (const n of NAMES) expect(fn(n)).toBe(shellQuote(n));
  });
});

describe("recaptureCommand", () => {
  it("quotes the flow and the step id, and keeps the workspace placeholder", () => {
    expect(recaptureCommand("my flow/v 1", "step 1")).toBe(
      "docsxai run <workspace> --flow 'my flow' --start-from 'step 1'",
    );
    expect(recaptureCommand(undefined, "a")).toBe("docsxai run <workspace> --start-from a");
  });
});

describe("the copyable capture command in pages", () => {
  it("viewer: a missing-screenshot step with a space in its name copies a quoted command", () => {
    const html = stepHtml({ id: "open menu", screenshot: null, anns: [], md: null }, 1, "my flow");
    expect(html).toContain(
      "docsxai run &lt;workspace&gt; --flow 'my flow' --start-from 'open menu'",
    );
  });

  it("site: AnnotatedShot quotes the flow and the step id", () => {
    const src = annotatedShotAstro(uiStrings());
    expect(src).toContain('shellQuote(flow.split("/")[0])');
    expect(src).toContain("shellQuote(alt)");
    expect(src).toContain(SHELL_QUOTE_SRC);
  });
});
