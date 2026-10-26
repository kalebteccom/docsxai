import { describe, expect, it } from "vitest";
import { isSafeFlowName, isSafeStepId, showName } from "../src/safe-id.js";

describe("isSafeStepId", () => {
  it("accepts ordinary ids", () => {
    for (const id of ["open-sidebar", "step_1", "a.b", "Étape 2", "x-y.z"]) {
      expect(isSafeStepId(id)).toBe(true);
    }
  });

  it("refuses separators, parent references, colons, control characters and nothing", () => {
    for (const id of [
      "",
      "../../x",
      "..",
      "a..b",
      "a/b",
      "a\\b",
      "javascript:x",
      "a\u0000b",
      "a\nb",
      "a\u001bb",
      "a\u007fb",
      "a\u0085b",
    ]) {
      expect(isSafeStepId(id), JSON.stringify(id)).toBe(false);
    }
  });
});

describe("isSafeFlowName", () => {
  it("accepts a flow and a flow/variant pair", () => {
    expect(isSafeFlowName("tour")).toBe(true);
    expect(isSafeFlowName("tour/fr-FR.dark.mobile")).toBe(true);
  });

  it("refuses anything that could leave the docs directory or read as a URL scheme", () => {
    for (const flow of [
      "",
      ".",
      "..",
      "../evil",
      "a/../b",
      "/abs",
      "a//b",
      "a/b/c",
      "a/",
      "javascript:alert(1)",
      "a\\b",
      "a\u001bb",
    ]) {
      expect(isSafeFlowName(flow), JSON.stringify(flow)).toBe(false);
    }
  });
});

const BIDI = [
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
  "\u200e",
  "\u200f",
  "\u061c",
];

describe("bidi control characters", () => {
  it("refuses a step id or flow name holding any bidi control", () => {
    for (const ch of BIDI) {
      expect(isSafeStepId(`pay${ch}1`), JSON.stringify(ch)).toBe(false);
      expect(isSafeFlowName(`tour${ch}`), JSON.stringify(ch)).toBe(false);
      expect(isSafeFlowName(`tour/fr${ch}`), JSON.stringify(ch)).toBe(false);
    }
  });

  it("refuses an id that would display as another one", () => {
    // U+202E reverses what follows, so this id shows on screen as "step-1-exe.png".
    expect(isSafeStepId("step-1-\u202egnp.exe")).toBe(false);
  });

  it("keeps right-to-left letters and other non-ASCII names", () => {
    expect(isSafeStepId("خطوة-1")).toBe(true);
    expect(isSafeFlowName("סיור/he-IL")).toBe(true);
  });

  it("shows bidi controls as escapes in a warning", () => {
    expect(showName("a\u202eb")).toBe('"a\\u202eb"');
    expect(showName("a\u061cb\u2066")).toBe('"a\\u061cb\\u2066"');
  });
});

describe("showName", () => {
  it("quotes a name and shows control characters as escapes", () => {
    expect(showName("a/b")).toBe('"a/b"');
    expect(showName("a\u001bb")).toBe('"a\\u001bb"');
    expect(showName("a\u0085b")).toBe('"a\\u0085b"');
    expect(showName("a\u007fb")).toBe('"a\\u007fb"');
  });
});
