// Contract: the flow-file schema and the doc-pack schemas (annotations, style, locators, auth
// strategy, revision metadata).
//
// Snapshot: snapshots/doc-pack-schemas.json, a JSON dump of every Zod schema in doc-pack.ts
// (field names, optional or defaulted fields, enum values, bounds, strictness) plus the numeric
// defaults the flow-file docs promise. Refinements are not visible in a dump, so the behavioural
// tests below pin them (mutually exclusive annotation forms, where `timeout_ms` is legal).
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed field, a removed enum value or a tighter bound is a
//      breaking change; a new optional field is additive. A new schema id (`@2`) needs a deprecation
//      period for `@1`.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeZod,
  expectJsonSnapshot,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import {
  ActionType,
  AnnotationPlacement,
  AnnotationRecord,
  AnnotationsFile,
  AuthStrategyDescriptor,
  BoundingBox,
  FlowFile,
  LocatorManifest,
  RevisionMeta,
  StyleArtifact,
  VIEWPORT_PRESETS,
} from "../../src/doc-pack.js";
import { parseFlowFile, serializeFlowFile } from "../../src/flow-file.js";
import { OBSTACLE_LIMIT, OBSTACLE_RADIUS } from "../../src/obstacles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshots = path.join(here, "snapshots");
const viewerAnnotations = path.join(here, "..", "..", "..", "viewer", "src", "annotations.ts");

describe("doc-pack schema contract", () => {
  it("matches the checked-in schema snapshot", () => {
    expectJsonSnapshot(path.join(snapshots, "doc-pack-schemas.json"), {
      schemas: {
        FlowFile: describeZod(FlowFile),
        AnnotationsFile: describeZod(AnnotationsFile),
        StyleArtifact: describeZod(StyleArtifact),
        LocatorManifest: describeZod(LocatorManifest),
        AuthStrategyDescriptor: describeZod(AuthStrategyDescriptor),
        RevisionMeta: describeZod(RevisionMeta),
      },
      defaults: {
        viewportPresets: VIEWPORT_PRESETS,
        obstacleRadius: OBSTACLE_RADIUS,
        obstacleLimit: OBSTACLE_LIMIT,
      },
    });
  });

  it("keeps the viewer's structural mirror of the annotation records in step", () => {
    const mirror = (name: string) =>
      Object.keys(typeMembers(viewerAnnotations, name).members).sort();
    expect(mirror("AnnotationRecord")).toEqual(Object.keys(AnnotationRecord.shape).sort());
    expect(mirror("AnnotationPlacement")).toEqual(Object.keys(AnnotationPlacement.shape).sort());
    expect(mirror("BoundingBox")).toEqual(Object.keys(BoundingBox.shape).sort());
  });
});

// Every action, wait kind, success kind, environment key, redaction form and annotation key a
// 1.0 flow-file may use. If this stops parsing, a flow that worked before no longer does.
const FULL_VOCABULARY_FLOW = `
name: full-vocabulary
environment:
  clock: "2030-01-02T03:04:05Z"
  locale: en-GB
  timezone: Europe/Amsterdam
  viewport: { width: 1280, height: 800 }
  color_scheme: dark
  reduced_motion: true
redactions:
  - selector: $secret
    style: pixelate
  - region: { x: 0, y: 0, width: 100, height: 20 }
prerequisites:
  - logged_in_as: editor
  - feature_flag: true
locators:
  banner: "#banner"
  field: "#field"
  file: "#file"
  btn: "#btn"
  menu: "#menu"
  box: "#box"
  toast: "#toast"
  secret: "#secret"
steps:
  - id: open
    action: navigate
    value: /start
    wait_for: settled
    timeout_ms: 5000
  - id: hide-banner
    action: hide
    target: $banner
    optional: true
    timeout_ms: 1500
  - id: type
    action: fill
    target: $field
    value: hello
    wait_for: network_idle
  - id: attach
    action: upload
    target: $file
    value: fixtures/a.png
  - id: submit
    action: click
    target: $btn
    wait_for: { selector: $toast, timeout_ms: 20000 }
    success: { visible: $toast }
    annotation:
      copy: Saved
      arrow: top-left
      nudge: { x: 5, y: -5 }
      target: $toast
      placement:
        inside: false
        side: bottom
        align: center
        pin_arrow: true
        max_width: 300
        obstacle_radius: 200
        obstacle_limit: 10
  - id: key
    action: press
    value: Enter
    wait_for: load
  - id: over
    action: hover
    target: $menu
    wait_for: element_stable
  - id: pick
    action: select
    target: $menu
    value: two
  - id: tick
    action: check
    target: $box
  - id: untick
    action: uncheck
    target: $box
  - id: pause
    action: wait
    wait_for: { timeout_ms: 250 }
  - id: pause-for-toast
    action: wait
    wait_for: { selector: $toast }
    timeout_ms: 2000
  - id: reveal
    action: show
  - id: gone
    action: click
    target: $btn
    success: { hidden: $toast }
  - id: moved
    action: click
    target: $btn
    success: { url_matches: "/done$" }
  - id: text
    action: click
    target: $btn
    success: { text_contains: { selector: $toast, text: Saved } }
    redactions:
      - selector: $secret
    annotations:
      - copy: First
      - copy: Second
        arrow: right
        target: $toast
`;

const MINIMAL_FLOW = `
name: minimal
steps:
  - id: only
    action: wait
`;

describe("flow-file behaviour contract", () => {
  it("accepts a flow that uses the whole vocabulary", () => {
    const flow = parseFlowFile(FULL_VOCABULARY_FLOW, "full-vocabulary");
    expect([...new Set(flow.steps.map((s) => s.action))].sort()).toEqual(
      [...ActionType.options].sort(),
    );
  });

  it("round-trips through serializeFlowFile", () => {
    const flow = parseFlowFile(FULL_VOCABULARY_FLOW, "full-vocabulary");
    expect(parseFlowFile(serializeFlowFile(flow), "round-trip")).toEqual(flow);
  });

  it("defaults `prerequisites` and `locators` to empty", () => {
    const flow = parseFlowFile(MINIMAL_FLOW);
    expect(flow.prerequisites).toEqual([]);
    expect(flow.locators).toEqual({});
  });

  it("rejects an unknown top-level key, an unknown step key and an unknown action", () => {
    expect(() => parseFlowFile(`${MINIMAL_FLOW}surprise: 1\n`)).toThrow(/surprise/);
    expect(() =>
      parseFlowFile("name: f\nsteps:\n  - id: s\n    action: wait\n    surprise: 1\n"),
    ).toThrow(/surprise/);
    expect(() => parseFlowFile("name: f\nsteps:\n  - id: s\n    action: teleport\n")).toThrow(
      /action/,
    );
  });

  it("rejects both annotation forms on one step", () => {
    const yaml = [
      "name: f",
      "locators: { a: '#a' }",
      "steps:",
      "  - id: s",
      "    action: click",
      "    target: $a",
      "    annotation: { copy: one }",
      "    annotations: [{ copy: two }]",
      "",
    ].join("\n");
    expect(() => parseFlowFile(yaml)).toThrow(/annotation/);
  });

  it("rejects `timeout_ms` where it would bound nothing", () => {
    const yaml =
      "name: f\nsteps:\n  - id: s\n    action: navigate\n    value: /\n    timeout_ms: 500\n";
    expect(() => parseFlowFile(yaml)).toThrow(/timeout_ms/);
  });

  it("rejects an unresolved locator reference and a duplicate step id", () => {
    expect(() =>
      parseFlowFile("name: f\nsteps:\n  - id: s\n    action: click\n    target: $missing\n"),
    ).toThrow(/\$missing/);
    expect(() =>
      parseFlowFile("name: f\nsteps:\n  - id: s\n    action: wait\n  - id: s\n    action: wait\n"),
    ).toThrow(/duplicate step ids/);
  });
});

describe("annotations.json behaviour contract", () => {
  const record = {
    step: "submit",
    selector: "#btn",
    bounding_box: { x: 1, y: 2, width: 3, height: 4 },
    copy: "Saved",
    arrow_style: "top",
    nudge: { x: 1, y: 1 },
    obstacles: [{ x: 0, y: 0, width: 1, height: 1 }],
    placement: { side: "left" },
    index: 1,
  };

  it("accepts a record that sets every documented key", () => {
    const file = { schema: "docsxai/annotations@1", flow: "f", annotations: [record] };
    expect(AnnotationsFile.safeParse(file).success).toBe(true);
  });

  it("rejects another schema id and an unknown record key", () => {
    expect(
      AnnotationsFile.safeParse({ schema: "docsxai/annotations@2", flow: "f", annotations: [] })
        .success,
    ).toBe(false);
    expect(
      AnnotationsFile.safeParse({
        schema: "docsxai/annotations@1",
        flow: "f",
        annotations: [{ ...record, surprise: true }],
      }).success,
    ).toBe(false);
  });
});
