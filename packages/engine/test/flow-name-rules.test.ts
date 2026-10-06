// What a flow name may not be because of the disks it lands on: a Windows device name, a trailing
// dot, and two names that are one directory on a case-insensitive disk.

import { describe, expect, it } from "vitest";
import { FlowName, type FlowFile } from "../src/doc-pack.js";
import { FlowFileError, parseFlowFile } from "../src/flow-file.js";
import { expandFlows, FlowMatrixError } from "../src/flow-matrix.js";
import {
  assertNoCaseCollision,
  findCaseCollision,
  hasTrailingDot,
  isWindowsDeviceName,
} from "../src/flow-name-rules.js";

const flowText = (name: string, extra = "") =>
  `name: ${name}\n${extra}steps:\n  - id: s\n    action: wait\n`;
const flow = (name: string) => parseFlowFile(flowText(name));

describe("isWindowsDeviceName", () => {
  it.each([
    "con",
    "CON",
    "Prn",
    "aux",
    "nul",
    "com1",
    "COM9",
    "lpt1",
    "Lpt9",
    "con.v2",
    "NUL.flow",
    "aux.a.b",
  ])("flags %j", (name) => {
    expect(isWindowsDeviceName(name)).toBe(true);
  });

  it.each(["console", "con-x", "con_1", "com0", "com10", "lpt0", "auxiliary", "a.con", "tour"])(
    "leaves %j alone",
    (name) => {
      expect(isWindowsDeviceName(name)).toBe(false);
    },
  );
});

describe("hasTrailingDot", () => {
  it("flags a name that ends in a dot", () => {
    expect(hasTrailingDot("tour.")).toBe(true);
    expect(hasTrailingDot("tour.v2")).toBe(false);
    expect(hasTrailingDot("tour")).toBe(false);
  });
});

describe("FlowName", () => {
  it.each(["tour", "Board_1.v2", "console", "com10", "con-x", "a"])("accepts %j", (name) => {
    expect(FlowName.safeParse(name).success).toBe(true);
  });

  it.each(["trailing.", "con", "NUL", "com1", "lpt9", "con.v2", "Aux.flow"])(
    "rejects %j",
    (name) => {
      expect(FlowName.safeParse(name).success).toBe(false);
    },
  );

  it("says why in the message", () => {
    const dot = FlowName.safeParse("tour.");
    expect(dot.success ? "" : dot.error.issues.map((i) => i.message).join(";")).toContain(
      "must not end with `.`",
    );
    const device = FlowName.safeParse("nul");
    expect(device.success ? "" : device.error.issues.map((i) => i.message).join(";")).toContain(
      "Windows device name",
    );
  });

  it("is enforced on a parsed flow-file, for name and extends", () => {
    expect(() => parseFlowFile(flowText("con"))).toThrow(FlowFileError);
    expect(() => parseFlowFile(flowText("tour."))).toThrow(FlowFileError);
    expect(() => parseFlowFile(flowText("tour", "extends: nul\n"))).toThrow(FlowFileError);
    expect(parseFlowFile(flowText("console")).name).toBe("console");
  });
});

describe("findCaseCollision", () => {
  it("returns the first two names that differ only by case, in the order given", () => {
    expect(findCaseCollision(["a", "Board", "b", "board", "BOARD"])).toEqual(["Board", "board"]);
  });

  it("returns null for distinct names and for exact repeats", () => {
    expect(findCaseCollision(["a", "b", "ab"])).toBeNull();
    expect(findCaseCollision(["a", "a"])).toBeNull();
    expect(findCaseCollision([])).toBeNull();
  });
});

describe("assertNoCaseCollision", () => {
  it("names the pair and what they are", () => {
    expect(() => assertNoCaseCollision(["Tour", "tour"], "flow names")).toThrow(
      /flow names "Tour" and "tour" differ only by case/,
    );
    expect(() => assertNoCaseCollision(["tour", "other"], "flow names")).not.toThrow();
  });
});

describe("expandFlows", () => {
  const MATRIX = flowText("tour", "matrix: { color_schemes: [light, dark] }\n");

  it("expands every flow in order", () => {
    const units = expandFlows([parseFlowFile(MATRIX), flow("plain")]);
    expect(units.map((u) => [u.flow.name, u.id])).toEqual([
      ["tour", "light"],
      ["tour", "dark"],
      ["plain", null],
    ]);
  });

  it("refuses two flows whose names differ only by case, before expanding", () => {
    const flows: FlowFile[] = [flow("Tour"), flow("tour")];
    expect(() => expandFlows(flows)).toThrow(FlowMatrixError);
    expect(() => expandFlows(flows)).toThrow(/"Tour" and "tour" differ only by case/);
  });
});
