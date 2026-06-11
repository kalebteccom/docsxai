// `environment` + `redactions` schema acceptance/rejection, `extends` merge semantics, and the
// EnvironmentSpec → Playwright context-options mapping (pure — no browser).

import { describe, expect, it } from "vitest";
import { EnvironmentSpec, RedactionSpec, VIEWPORT_PRESETS } from "../src/doc-pack.js";
import { parseFlowFile, resolveFlowExtends } from "../src/flow-file.js";
import { environmentContextOptions } from "../src/playwright-driver.js";

const MINIMAL_STEPS = `
steps:
  - id: s1
    action: wait
`;

describe("EnvironmentSpec schema", () => {
  it("accepts a fully-populated environment block (preset viewport)", () => {
    const flow = parseFlowFile(`
name: f
environment:
  clock: "2030-01-02T03:04:05Z"
  locale: en-GB
  timezone: Europe/Amsterdam
  viewport: tablet
  color_scheme: dark
  reduced_motion: true
${MINIMAL_STEPS}`);
    expect(flow.environment).toEqual({
      clock: "2030-01-02T03:04:05Z",
      locale: "en-GB",
      timezone: "Europe/Amsterdam",
      viewport: "tablet",
      color_scheme: "dark",
      reduced_motion: true,
    });
  });

  it("accepts an explicit { width, height } viewport", () => {
    const flow = parseFlowFile(`
name: f
environment:
  viewport: { width: 800, height: 600 }
${MINIMAL_STEPS}`);
    expect(flow.environment?.viewport).toEqual({ width: 800, height: 600 });
  });

  it("accepts an offset ISO-8601 clock", () => {
    expect(EnvironmentSpec.safeParse({ clock: "2030-06-01T10:00:00+02:00" }).success).toBe(true);
  });

  it("rejects a non-datetime clock", () => {
    expect(EnvironmentSpec.safeParse({ clock: "tomorrow" }).success).toBe(false);
    expect(EnvironmentSpec.safeParse({ clock: "2030-01-02" }).success).toBe(false);
  });

  it("rejects a malformed locale", () => {
    expect(EnvironmentSpec.safeParse({ locale: "english please" }).success).toBe(false);
  });

  it("rejects an unknown viewport preset", () => {
    expect(EnvironmentSpec.safeParse({ viewport: "cinema" }).success).toBe(false);
  });

  it("rejects non-positive viewport dimensions", () => {
    expect(EnvironmentSpec.safeParse({ viewport: { width: 0, height: 600 } }).success).toBe(false);
    expect(EnvironmentSpec.safeParse({ viewport: { width: 800, height: -1 } }).success).toBe(false);
  });

  it("rejects an unknown color_scheme and unknown keys (strict)", () => {
    expect(EnvironmentSpec.safeParse({ color_scheme: "sepia" }).success).toBe(false);
    expect(EnvironmentSpec.safeParse({ dark_mode: true }).success).toBe(false);
  });

  it("exports the documented viewport presets", () => {
    expect(VIEWPORT_PRESETS).toEqual({
      desktop: { width: 1440, height: 900 },
      tablet: { width: 834, height: 1112 },
      mobile: { width: 390, height: 844 },
    });
  });
});

describe("RedactionSpec schema", () => {
  it("accepts selector and region forms (style optional)", () => {
    expect(RedactionSpec.safeParse({ selector: "#secret" }).success).toBe(true);
    expect(RedactionSpec.safeParse({ selector: "$secret", style: "pixelate" }).success).toBe(true);
    expect(
      RedactionSpec.safeParse({ region: { x: 0, y: 0, width: 10, height: 10 }, style: "box" })
        .success,
    ).toBe(true);
  });

  it("rejects a spec with both selector and region, an unknown style, and a zero-size region", () => {
    expect(
      RedactionSpec.safeParse({ selector: "#a", region: { x: 0, y: 0, width: 1, height: 1 } })
        .success,
    ).toBe(false);
    expect(RedactionSpec.safeParse({ selector: "#a", style: "blur" }).success).toBe(false);
    expect(RedactionSpec.safeParse({ region: { x: 0, y: 0, width: 0, height: 10 } }).success).toBe(
      false,
    );
  });

  it("parses flow-level + step-level redactions in a flow-file", () => {
    const flow = parseFlowFile(`
name: f
locators: { secret: '#secret' }
redactions:
  - { selector: $secret }
steps:
  - id: s1
    action: wait
    redactions:
      - { region: { x: 1, y: 2, width: 3, height: 4 }, style: pixelate }
`);
    expect(flow.redactions).toEqual([{ selector: "$secret" }]);
    expect(flow.steps[0]!.redactions).toEqual([
      { region: { x: 1, y: 2, width: 3, height: 4 }, style: "pixelate" },
    ]);
  });

  it("rejects an unresolved $ref in flow-level redactions", () => {
    expect(() =>
      parseFlowFile(`
name: f
redactions:
  - { selector: $ghost }
${MINIMAL_STEPS}`),
    ).toThrow(/unresolved locator/i);
  });

  it("rejects an unresolved $ref in step-level redactions", () => {
    expect(() =>
      parseFlowFile(`
name: f
steps:
  - id: s1
    action: wait
    redactions:
      - { selector: $ghost }
`),
    ).toThrow(/unresolved locator/i);
  });
});

describe("extends merge — environment + redactions", () => {
  const PARENT = `
name: base
environment:
  clock: "2030-01-02T03:04:05Z"
  locale: en-GB
  viewport: desktop
locators: { secret: '#secret' }
redactions:
  - { selector: $secret }
steps:
  - id: p1
    action: wait
`;

  it("merges per-key with the child winning; redactions concatenate parent-first", async () => {
    const child = parseFlowFile(`
name: child
extends: base
environment:
  viewport: mobile
  color_scheme: dark
redactions:
  - { region: { x: 0, y: 0, width: 5, height: 5 } }
steps:
  - id: c1
    action: wait
`);
    const merged = await resolveFlowExtends(child, () => parseFlowFile(PARENT));
    expect(merged.environment).toEqual({
      clock: "2030-01-02T03:04:05Z",
      locale: "en-GB",
      viewport: "mobile",
      color_scheme: "dark",
    });
    expect(merged.redactions).toEqual([
      { selector: "$secret" },
      { region: { x: 0, y: 0, width: 5, height: 5 } },
    ]);
  });

  it("inherits the parent's environment + redactions wholesale when the child sets none", async () => {
    const child = parseFlowFile(`
name: child
extends: base
steps:
  - id: c1
    action: wait
`);
    const merged = await resolveFlowExtends(child, () => parseFlowFile(PARENT));
    expect(merged.environment).toEqual({
      clock: "2030-01-02T03:04:05Z",
      locale: "en-GB",
      viewport: "desktop",
    });
    expect(merged.redactions).toEqual([{ selector: "$secret" }]);
  });

  it("emits no environment / redactions keys when neither flow has them", async () => {
    const parent = parseFlowFile(`name: base\nsteps:\n  - id: p1\n    action: wait\n`);
    const child = parseFlowFile(
      `name: child\nextends: base\nsteps:\n  - id: c1\n    action: wait\n`,
    );
    const merged = await resolveFlowExtends(child, () => parent);
    expect(merged.environment).toBeUndefined();
    expect(merged.redactions).toBeUndefined();
  });
});

describe("environmentContextOptions", () => {
  it("maps locale / timezone / color_scheme / reduced_motion and expands viewport presets", () => {
    expect(
      environmentContextOptions({
        clock: "2030-01-02T03:04:05Z",
        locale: "en-GB",
        timezone: "Europe/Amsterdam",
        viewport: "mobile",
        color_scheme: "dark",
        reduced_motion: true,
      }),
    ).toEqual({
      locale: "en-GB",
      timezoneId: "Europe/Amsterdam",
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
  });

  it("passes an explicit viewport size through and maps reduced_motion:false to no-preference", () => {
    expect(
      environmentContextOptions({ viewport: { width: 800, height: 600 }, reduced_motion: false }),
    ).toEqual({ viewport: { width: 800, height: 600 }, reducedMotion: "no-preference" });
  });

  it("emits nothing for an empty environment (clock is a page-level install, not a context option)", () => {
    expect(environmentContextOptions({})).toEqual({});
    expect(environmentContextOptions({ clock: "2030-01-02T03:04:05Z" })).toEqual({});
  });
});
