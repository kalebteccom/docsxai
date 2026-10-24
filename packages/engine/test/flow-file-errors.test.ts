// What parseFlowFile prints for a flow-file that fails the schema: the path of the bad field, also
// when the field sits in a union (zod 4 keeps the branch issues inside the union issue and
// `expandIssue` prefixes the union's own path), in a record, or in a nested object; and the zod 4
// defaults on optional fields.

import { describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";

const HEAD = "name: f\nlocators: { btn: '#b' }\n";
const hover = (id: string, extra = ""): string =>
  `  - id: ${id}\n    action: hover\n    target: $btn\n${extra}`;
const flow = (top: string, ...steps: string[]): string =>
  `${HEAD}${top}steps:\n${(steps.length ? steps : [hover("s1")]).join("")}`;

const messageOf = (text: string): string => {
  try {
    parseFlowFile(text, "f.flow.yaml");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected parseFlowFile to throw");
};
const lines = (message: string): string[] => message.split("\n").slice(1);

describe("a union nested in the steps", () => {
  it("prefixes the step index and the union's path in front of the closest branch's field", () => {
    const text = flow(
      "",
      hover("s1", "    success: { visible: $btn }\n"),
      hover("s2"),
      hover("s3", "    success:\n      text_contains: { selector: $btn, text: 5 }\n"),
    );
    const msg = messageOf(text);
    expect(msg).toMatch(/^f\.flow\.yaml: invalid flow-file:\n/);
    expect(lines(msg)).toHaveLength(1);
    expect(lines(msg)[0]).toMatch(/^ {2}• steps\.2\.success\.text_contains\.text: /);
  });

  it("names the second step, not the first, when only the second is wrong", () => {
    const msg = messageOf(
      flow(
        "",
        hover("s1", "    success: { visible: $btn }\n"),
        hover("s2", "    success: { visible: 5 }\n"),
      ),
    );
    expect(msg).toContain("steps.1.success.visible:");
    expect(msg).not.toContain("steps.0.");
  });

  it("names the field of the wait_for branch that got deepest", () => {
    expect(messageOf(flow("", hover("s1", "    wait_for: { selector: 5 }\n")))).toContain(
      "steps.0.wait_for.selector:",
    );
    expect(messageOf(flow("", hover("s1", "    wait_for: { timeout_ms: -5 }\n")))).toContain(
      "steps.0.wait_for.timeout_ms:",
    );
  });

  it("stops at the union itself when no branch got past the value", () => {
    const num = messageOf(flow("", hover("s1", "    wait_for: 7\n")));
    expect(lines(num)).toHaveLength(1);
    expect(lines(num)[0]).toMatch(/^ {2}• steps\.0\.wait_for: /);
    const word = messageOf(flow("", hover("s1", "    wait_for: whenever\n")));
    expect(word).toMatch(/steps\.0\.wait_for: .*network_idle/);
    expect(messageOf(flow("", hover("s1", "    success: 5\n")))).toContain("steps.0.success:");
  });

  it("prints every issue of the winning branch, each under the union's path", () => {
    const msg = messageOf(flow("", hover("s1", "    success: { visible: 5, hidden: $btn }\n")));
    expect(msg).toContain("steps.0.success.visible:");
    expect(msg).toMatch(/steps\.0\.success: Unrecognized key/);
    expect(msg).toContain("hidden");
  });

  it("reports two unions in two steps on two lines", () => {
    const msg = messageOf(
      flow(
        "",
        hover("s1", "    success: { visible: 5 }\n"),
        hover("s2", "    wait_for: { selector: 5 }\n"),
      ),
    );
    expect(lines(msg).map((l) => l.split(":")[0])).toEqual([
      "  • steps.0.success.visible",
      "  • steps.1.wait_for.selector",
    ]);
  });
});

describe("a union outside the steps", () => {
  it("names a flow-level redaction by index and field", () => {
    expect(messageOf(flow("redactions:\n  - selector: 5\n"))).toContain("redactions.0.selector:");
    expect(
      messageOf(flow("redactions:\n  - region: { x: -1, y: 0, width: 5, height: 5 }\n")),
    ).toContain("redactions.0.region.x:");
  });

  it("names a step-level redaction under its step", () => {
    const msg = messageOf(flow("", hover("s1", "    redactions:\n      - selector: 5\n")));
    expect(msg).toContain("steps.0.redactions.0.selector:");
  });

  it("names the viewport field inside environment, and a mistyped preset at the union", () => {
    expect(messageOf(flow("environment:\n  viewport: { width: abc, height: 5 }\n"))).toContain(
      "environment.viewport.width:",
    );
    const preset = messageOf(flow("environment:\n  viewport: tablett\n"));
    expect(preset).toMatch(/environment\.viewport: .*tablet/);
  });

  it("names the entry of a matrix viewport list", () => {
    const text = flow(
      "matrix:\n  viewports:\n    - mobile\n    - { width: abc, height: 5 }\n    - { name: Wide, width: 5, height: 5 }\n",
    );
    const msg = messageOf(text);
    expect(msg).toContain("matrix.viewports.1.width:");
    expect(msg).toMatch(/matrix\.viewports\.2\.name: must be lowercase letters/);
    expect(msg).not.toContain("matrix.viewports.0");
  });

  it("names the key of a prerequisite whose value is neither a string nor a boolean", () => {
    expect(messageOf(flow("prerequisites:\n  - { logged_in_as: 5 }\n"))).toContain(
      "prerequisites.0.logged_in_as:",
    );
  });
});

describe("records, refinements and the root", () => {
  it("names the key of a locator whose value is not a string", () => {
    const msg = messageOf("name: f\nlocators: { btn: 5 }\nsteps:\n" + hover("s1"));
    expect(lines(msg)).toEqual([
      "  • locators.btn: Invalid input: expected string, received number",
    ]);
  });

  it("names the key of a copy_by_locale entry that is not a language tag", () => {
    const msg = messageOf(
      flow("", hover("s1", "    annotation: { copy: Hi, copy_by_locale: { x: Hola } }\n")),
    );
    expect(msg).toContain("steps.0.annotation.copy_by_locale.x:");
    expect(msg).toContain("Invalid key in record");
  });

  it("names copy_by_locale itself when the map is empty", () => {
    const msg = messageOf(
      flow("", hover("s1", "    annotation: { copy: Hi, copy_by_locale: {} }\n")),
    );
    expect(msg).toContain("steps.0.annotation.copy_by_locale: needs at least one locale");
  });

  it("puts a refinement's message on the path the schema names", () => {
    const both = hover(
      "s1",
      "    annotation: { copy: a }\n    annotations:\n      - { copy: b }\n",
    );
    expect(messageOf(flow("", both))).toMatch(/steps\.0\.annotations: step has both `annotation`/);
    const msg = messageOf(
      flow("", "  - id: n\n    action: navigate\n    value: /\n    timeout_ms: 500\n"),
    );
    expect(msg).toMatch(/steps\.0\.timeout_ms: `timeout_ms` has no effect/);
  });

  it("names the step for an unknown key and the root for a document that is not a mapping", () => {
    const unknown = messageOf(flow("", hover("s1", "    bogus: 1\n")));
    expect(unknown).toMatch(/steps\.0: Unrecognized key.*bogus/);
    for (const text of ["", "just text\n", "- a\n- b\n"]) {
      expect(lines(messageOf(text))[0]).toMatch(/^ {2}• \(root\): /);
    }
  });

  it("names steps itself when the list is empty", () => {
    expect(messageOf(`${HEAD}steps: []\n`)).toMatch(/steps: Too small/);
  });
});

describe("defaults on optional fields", () => {
  const MIN = "name: f\nsteps:\n  - id: s1\n    action: navigate\n    value: /\n";

  it("fills in prerequisites and locators when they are absent", () => {
    const parsed = parseFlowFile(MIN);
    expect(parsed.prerequisites).toEqual([]);
    expect(parsed.locators).toEqual({});
  });

  it("hands each parse its own default", () => {
    const first = parseFlowFile(MIN);
    first.locators["x"] = "#x";
    first.prerequisites.push({ a: true });
    const second = parseFlowFile(MIN);
    expect(second.locators).toEqual({});
    expect(second.prerequisites).toEqual([]);
  });

  it("does not default a null, and says which field was null", () => {
    expect(messageOf(MIN + "locators: null\n")).toContain(
      "locators: Invalid input: expected record",
    );
    expect(messageOf(MIN + "prerequisites: null\n")).toContain(
      "prerequisites: Invalid input: expected array",
    );
  });

  it("leaves optional fields off the parsed flow when they are absent", () => {
    const parsed = parseFlowFile(MIN);
    for (const key of ["extends", "environment", "matrix", "redactions"]) {
      expect(key in parsed).toBe(false);
    }
    expect("optional" in parsed.steps[0]!).toBe(false);
  });
});
