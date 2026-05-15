import { describe, expect, it } from "vitest";
import type { FlowFile } from "../src/doc-pack.js";
import { parseFlowFile } from "../src/flow-file.js";
import { buildFlowTree, formatTreeText } from "../src/flow-tree.js";

function mk(...sources: string[]): Map<string, FlowFile> {
  const m = new Map<string, FlowFile>();
  for (const s of sources) {
    const f = parseFlowFile(s);
    m.set(f.name, f);
  }
  return m;
}

describe("buildFlowTree", () => {
  it("returns empty roots/orphans/issues for an empty workspace", async () => {
    const r = await buildFlowTree(new Map());
    expect(r).toEqual({ roots: [], orphans: [], issues: [] });
  });

  it("a single root flow appears in roots with its step count", async () => {
    const flows = mk(`
name: solo
locators: { x: '#x' }
steps:
  - id: a
    action: click
    target: $x
  - id: b
    action: wait
`);
    const r = await buildFlowTree(flows);
    expect(r.roots).toEqual([{ name: "solo", steps: 2, children: [] }]);
    expect(r.orphans).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("builds a parent/child tree", async () => {
    const flows = mk(
      `name: preamble\nlocators: { x: '#x' }\nsteps:\n  - id: p\n    action: click\n    target: $x\n`,
      `name: child-a\nextends: preamble\nsteps:\n  - id: a\n    action: wait\n`,
      `name: child-b\nextends: preamble\nsteps:\n  - id: b\n    action: wait\n`,
    );
    const r = await buildFlowTree(flows);
    expect(r.roots).toEqual([
      {
        name: "preamble",
        steps: 1,
        children: [
          { name: "child-a", steps: 1, children: [] },
          { name: "child-b", steps: 1, children: [] },
        ],
      },
    ]);
  });

  it("handles a three-level chain", async () => {
    const flows = mk(
      `name: a\nlocators: { x: '#x' }\nsteps:\n  - id: a1\n    action: click\n    target: $x\n`,
      `name: b\nextends: a\nsteps:\n  - id: b1\n    action: wait\n`,
      `name: c\nextends: b\nsteps:\n  - id: c1\n    action: wait\n`,
    );
    const r = await buildFlowTree(flows);
    expect(r.roots).toEqual([
      {
        name: "a",
        steps: 1,
        children: [
          {
            name: "b",
            steps: 1,
            children: [{ name: "c", steps: 1, children: [] }],
          },
        ],
      },
    ]);
  });

  it("flags a flow whose extends parent isn't in the workspace as an orphan", async () => {
    const flows = mk(`name: lonely\nextends: nonexistent\nsteps:\n  - id: s\n    action: wait\n`);
    const r = await buildFlowTree(flows);
    expect(r.roots).toEqual([]);
    expect(r.orphans).toEqual([{ name: "lonely", steps: 1, children: [] }]);
  });

  it("reports step-id collisions across the merge as an issue", async () => {
    const flows = mk(
      `name: parent\nlocators: { x: '#x' }\nsteps:\n  - id: shared\n    action: click\n    target: $x\n`,
      `name: child\nextends: parent\nsteps:\n  - id: shared\n    action: wait\n`,
    );
    const r = await buildFlowTree(flows);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.flow).toBe("child");
    expect(r.issues[0]!.message).toMatch(/collide/i);
  });
});

describe("formatTreeText", () => {
  it("renders a root flow and its descendants with ASCII connectors", async () => {
    const flows = mk(
      `name: preamble\nlocators: { x: '#x' }\nsteps:\n  - id: p\n    action: click\n    target: $x\n`,
      `name: a\nextends: preamble\nsteps:\n  - id: a1\n    action: wait\n`,
      `name: b\nextends: preamble\nsteps:\n  - id: b1\n    action: wait\n`,
    );
    const out = formatTreeText(await buildFlowTree(flows));
    expect(out).toContain("preamble    [1 step]");
    expect(out).toContain("├── a    [+1 step]");
    expect(out).toContain("└── b    [+1 step]");
    expect(out).toContain("3 flows, max chain depth 2");
  });

  it("surfaces orphans + issues in the summary", async () => {
    const flows = mk(
      `name: parent\nlocators: { x: '#x' }\nsteps:\n  - id: dup\n    action: click\n    target: $x\n`,
      `name: child\nextends: parent\nsteps:\n  - id: dup\n    action: wait\n`,
      `name: orphan\nextends: nothing\nsteps:\n  - id: s\n    action: wait\n`,
    );
    const out = formatTreeText(await buildFlowTree(flows));
    expect(out).toContain("orphan");
    expect(out).toMatch(/extends parent not in workspace/i);
    expect(out).toContain("issues:");
    expect(out).toMatch(/child: .*collide/i);
  });
});
