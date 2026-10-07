import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  isEditableTarget,
  keyAction,
  stepAnnouncement,
  stepInView,
  targetIndex,
} from "../src/viewer-keys.js";

describe("keyAction", () => {
  it.each([
    ["ArrowRight", { kind: "step", move: "next" }],
    ["j", { kind: "step", move: "next" }],
    ["ArrowLeft", { kind: "step", move: "prev" }],
    ["k", { kind: "step", move: "prev" }],
    ["Home", { kind: "step", move: "first" }],
    ["End", { kind: "step", move: "last" }],
    ["]", { kind: "flow", move: "next" }],
    ["[", { kind: "flow", move: "prev" }],
    ["Escape", { kind: "dismiss" }],
  ])("maps %s", (key, action) => {
    expect(keyAction({ key })).toEqual(action);
  });

  it("never handles Tab, so focus can always leave (no keyboard trap)", () => {
    expect(keyAction({ key: "Tab" })).toBeNull();
    expect(keyAction({ key: "Tab", shiftKey: true })).toBeNull();
  });

  it("leaves arrow keys that scroll the page vertically to the browser", () => {
    expect(keyAction({ key: "ArrowDown" })).toBeNull();
    expect(keyAction({ key: "ArrowUp" })).toBeNull();
    expect(keyAction({ key: " " })).toBeNull();
    expect(keyAction({ key: "PageDown" })).toBeNull();
  });

  it("passes modified keys through (Alt+← is browser Back, Cmd+] is forward)", () => {
    expect(keyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyAction({ key: "]", metaKey: true })).toBeNull();
    expect(keyAction({ key: "Home", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowRight", shiftKey: true })).toBeNull();
    expect(keyAction({ key: "Escape", ctrlKey: true })).toBeNull();
  });

  it("ignores keys typed into a field, except Escape", () => {
    expect(keyAction({ key: "j", editable: true })).toBeNull();
    expect(keyAction({ key: "ArrowLeft", editable: true })).toBeNull();
    expect(keyAction({ key: "Escape", editable: true })).toEqual({ kind: "dismiss" });
  });

  it("matches the documented table: every listed key yields its action", () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.display.length).toBe(s.keys.length);
      for (const key of s.keys) expect(keyAction({ key })).toEqual(s.action);
    }
  });
});

describe("targetIndex", () => {
  it("starts at the first step when none is current", () => {
    expect(targetIndex(-1, 4, "next")).toBe(0);
    expect(targetIndex(-1, 4, "prev")).toBe(0);
  });

  it("moves one step and stops at the ends", () => {
    expect(targetIndex(1, 4, "next")).toBe(2);
    expect(targetIndex(3, 4, "next")).toBe(3);
    expect(targetIndex(1, 4, "prev")).toBe(0);
    expect(targetIndex(0, 4, "prev")).toBe(0);
  });

  it("jumps to the first and last step", () => {
    expect(targetIndex(2, 4, "first")).toBe(0);
    expect(targetIndex(-1, 4, "last")).toBe(3);
  });

  it("returns -1 with no steps and recovers from an out-of-range current", () => {
    expect(targetIndex(0, 0, "next")).toBe(-1);
    expect(targetIndex(9, 3, "next")).toBe(0);
  });
});

describe("stepInView", () => {
  it("picks the first step whose bottom is below the top of the viewport", () => {
    expect(stepInView([-500, -10, 40, 900])).toBe(2);
    expect(stepInView([120, 900])).toBe(0);
  });

  it("returns -1 when every step is above the viewport or there are none", () => {
    expect(stepInView([-20, -1])).toBe(-1);
    expect(stepInView([])).toBe(-1);
  });
});

describe("stepAnnouncement", () => {
  it("names the position and the step", () => {
    expect(stepAnnouncement(1, 5, "open-sidebar")).toBe("Step 2 of 5: open-sidebar");
  });
});

describe("isEditableTarget", () => {
  it.each([
    ["INPUT", null, false, true],
    ["input", "search", false, true],
    ["INPUT", "checkbox", false, false],
    ["INPUT", "button", false, false],
    ["TEXTAREA", null, false, true],
    ["SELECT", null, false, true],
    ["DIV", null, true, true],
    ["SECTION", null, false, false],
    ["A", null, false, false],
    ["SUMMARY", null, false, false],
  ])("%s type=%s contenteditable=%s → %s", (tag, type, editable, expected) => {
    expect(isEditableTarget(tag, type, editable)).toBe(expected);
  });
});
