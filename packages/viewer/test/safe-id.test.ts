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

describe("showName", () => {
  it("quotes a name and shows control characters as escapes", () => {
    expect(showName("a/b")).toBe('"a/b"');
    expect(showName("a\u001bb")).toBe('"a\\u001bb"');
    expect(showName("a\u0085b")).toBe('"a\\u0085b"');
    expect(showName("a\u007fb")).toBe('"a\\u007fb"');
  });
});
