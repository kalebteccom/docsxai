// The flow matrix: schema bounds, cartesian expansion, environment overrides, only/skip, copy_by_locale,
// and the no-matrix path that must stay exactly the input.

import { describe, expect, it } from "vitest";
import {
  expandFlowVariants,
  FlowFileError,
  parseFlowFile,
  resolveFlowExtends,
  serializeFlowFile,
} from "../src/flow-file.js";
import { localeMatches, matrixVariantIds, pickCopy, variantDocDir } from "../src/flow-matrix.js";
import { MAX_MATRIX_VARIANTS } from "../src/matrix-spec.js";

const TOUR = `
name: tour
environment:
  clock: "2030-01-02T03:04:05Z"
  locale: en-GB
  viewport: desktop
locators: { title: "h1", tabs: "nav.tabs", chip: "button.chip" }
matrix:
  locales: [en-US, es-ES]
  color_schemes: [light, dark]
  viewports:
    - { name: wide, width: 1280, height: 800 }
    - mobile
steps:
  - id: open
    action: navigate
    value: /home
  - id: tabs
    action: wait
    target: $tabs
    skip: { viewport: [mobile] }
    annotation:
      copy: "Switch tabs"
      copy_by_locale: { es: "Cambia de pestana" }
  - id: chip
    action: wait
    target: $chip
    only: { viewport: [mobile] }
    annotations:
      - { target: $chip, copy: "Narrow the list" }
      - { target: $title, copy: "Dark title", only: { color_scheme: [dark] } }
`;

const stepIds = (flow: { steps: Array<{ id: string }> }) => flow.steps.map((s) => s.id);

describe("matrix expansion", () => {
  const variants = expandFlowVariants(parseFlowFile(TOUR));
  const byId = (id: string) => variants.find((v) => v.id === id)!;

  it("expands to the product, locales outermost, then color schemes, then viewports", () => {
    expect(variants.map((v) => v.id)).toEqual([
      "en-US.light.wide",
      "en-US.light.mobile",
      "en-US.dark.wide",
      "en-US.dark.mobile",
      "es-ES.light.wide",
      "es-ES.light.mobile",
      "es-ES.dark.wide",
      "es-ES.dark.mobile",
    ]);
  });

  it("round-trips through serializeFlowFile", () => {
    const flow = parseFlowFile(TOUR);
    expect(parseFlowFile(serializeFlowFile(flow))).toEqual(flow);
  });

  it("is deterministic: two parses expand to identical variants", () => {
    const again = expandFlowVariants(parseFlowFile(TOUR));
    expect(JSON.stringify(again)).toBe(JSON.stringify(variants));
  });

  it("overrides the environment per axis and keeps the other keys", () => {
    expect(byId("es-ES.dark.mobile").flow.environment).toEqual({
      clock: "2030-01-02T03:04:05Z",
      locale: "es-ES",
      viewport: { width: 390, height: 844 },
      color_scheme: "dark",
    });
    expect(byId("en-US.light.wide").flow.environment?.viewport).toEqual({
      width: 1280,
      height: 800,
    });
  });

  it("records the variant for annotations.json", () => {
    expect(byId("es-ES.dark.mobile").info).toEqual({
      id: "es-ES.dark.mobile",
      locale: "es-ES",
      color_scheme: "dark",
      viewport: { name: "mobile", width: 390, height: 844 },
    });
  });

  it("drops the matrix and the variant keys from the flow it returns", () => {
    for (const v of variants) {
      expect(v.flow.matrix).toBeUndefined();
      const json = JSON.stringify(v.flow);
      expect(json).not.toContain('"only"');
      expect(json).not.toContain('"skip"');
      expect(json).not.toContain("copy_by_locale");
    }
  });

  it("applies step-level only and skip on viewports", () => {
    expect(stepIds(byId("en-US.light.wide").flow)).toEqual(["open", "tabs"]);
    expect(stepIds(byId("en-US.light.mobile").flow)).toEqual(["open", "chip"]);
  });

  it("applies annotation-level only and renumbers by what is left", () => {
    const dark = byId("en-US.dark.mobile").flow.steps[1]!;
    expect(dark.annotations?.map((a) => a.copy)).toEqual(["Narrow the list", "Dark title"]);
    const light = byId("en-US.light.mobile").flow.steps[1]!;
    expect(light.annotations?.map((a) => a.copy)).toEqual(["Narrow the list"]);
  });

  it("resolves copy_by_locale by the variant locale, falling back to copy", () => {
    expect(byId("es-ES.light.wide").flow.steps[1]!.annotation?.copy).toBe("Cambia de pestana");
    expect(byId("en-US.light.wide").flow.steps[1]!.annotation?.copy).toBe("Switch tabs");
  });

  it("drops a filtered single annotation and strips the keys from a kept one", () => {
    const flow = parseFlowFile(`
name: f
matrix: { color_schemes: [light, dark] }
steps:
  - id: a
    action: wait
  - id: b
    action: wait
    annotation: { copy: "only dark", only: { color_scheme: [dark] } }
`);
    const [light, dark] = expandFlowVariants(flow);
    expect(light!.flow.steps[1]).toEqual({ id: "b", action: "wait" });
    expect(dark!.flow.steps[1]!.annotation).toEqual({ copy: "only dark" });
  });

  it("variant ids name only the axes the matrix has", () => {
    const ids = (matrix: string) =>
      matrixVariantIds(
        parseFlowFile(`name: f\nmatrix: ${matrix}\nsteps: [{ id: a, action: wait }]\n`).matrix!,
      );
    expect(ids("{ color_schemes: [dark, light] }")).toEqual(["dark", "light"]);
    expect(ids("{ locales: [fr-FR] }")).toEqual(["fr-FR"]);
    expect(ids("{ viewports: [{ width: 1280, height: 800 }, tablet] }")).toEqual([
      "1280x800",
      "tablet",
    ]);
  });

  it("builds the doc-pack directory of a variant, and the plain one without", () => {
    expect(variantDocDir("tour", "en-US.dark.wide")).toBe("docs/tour/en-US.dark.wide");
    expect(variantDocDir("tour", null)).toBe("docs/tour");
    expect(variantDocDir("tour", undefined)).toBe("docs/tour");
  });
});

describe("a flow without a matrix", () => {
  const PLAIN = `
name: recap-open
locators: { play_button: '#play-recap' }
steps:
  - id: open-app
    action: navigate
    value: index.html
  - id: open-sidebar
    action: click
    target: $play_button
    annotation: { copy: "Click Play", arrow: top-right }
`;

  it("expands to itself: one variant, no id, the same flow object", () => {
    const flow = parseFlowFile(PLAIN);
    const out = expandFlowVariants(flow);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBeNull();
    expect(out[0]!.info).toBeNull();
    expect(out[0]!.flow).toBe(flow);
  });

  it("serializes to the same YAML as before the matrix keys existed", () => {
    expect(serializeFlowFile(parseFlowFile(PLAIN))).not.toMatch(/matrix|only|skip|copy_by_locale/);
  });

  it("resolves copy_by_locale against environment.locale", () => {
    const flow = parseFlowFile(`
name: f
environment: { locale: es-ES }
steps:
  - id: a
    action: wait
    annotation: { copy: "Hello", copy_by_locale: { es: "Hola" } }
`);
    expect(expandFlowVariants(flow)[0]!.flow.steps[0]!.annotation).toEqual({ copy: "Hola" });
  });

  it("rejects only/skip, which need a matrix to mean anything", () => {
    expect(() =>
      parseFlowFile(
        `name: f\nsteps:\n  - id: a\n    action: wait\n    only: { viewport: [mobile] }\n`,
      ),
    ).toThrow(/needs a `matrix`/);
  });
});

describe("matrix bounds", () => {
  const withMatrix = (matrix: string) =>
    `name: f\nmatrix: ${matrix}\nsteps: [{ id: a, action: wait }]\n`;
  const tags = (n: number) => Array.from({ length: n }, (_, i) => `xx-${i + 1}`);

  it("allows exactly the cap", () => {
    const flow = parseFlowFile(
      withMatrix(`{ locales: [${tags(32).join(", ")}], color_schemes: [light, dark] }`),
    );
    expect(expandFlowVariants(flow)).toHaveLength(MAX_MATRIX_VARIANTS);
  });

  it("rejects a product over the cap, naming the product, each list and the limit", () => {
    const viewports = Array.from({ length: 9 }, (_, i) => `{ width: ${300 + i}, height: 600 }`);
    const src = withMatrix(
      `{ locales: [${tags(8).join(", ")}], viewports: [${viewports.join(", ")}] }`,
    );
    expect(() => parseFlowFile(src)).toThrow(FlowFileError);
    expect(() => parseFlowFile(src)).toThrow(
      /72 variants \(locales: 8, color_schemes: 0, viewports: 9\); the limit is 64/,
    );
  });

  it("rejects one list longer than the cap", () => {
    expect(() => parseFlowFile(withMatrix(`{ locales: [${tags(65).join(", ")}] }`))).toThrow(
      FlowFileError,
    );
  });

  it("rejects an empty matrix and an empty list", () => {
    expect(() => parseFlowFile(withMatrix("{}"))).toThrow(/at least one of/);
    expect(() => parseFlowFile(withMatrix("{ locales: [] }"))).toThrow(FlowFileError);
  });

  it("rejects an unknown axis, a bad locale and a bad viewport name", () => {
    expect(() => parseFlowFile(withMatrix("{ themes: [dark] }"))).toThrow(FlowFileError);
    expect(() => parseFlowFile(withMatrix("{ locales: ['en_US'] }"))).toThrow(/BCP-47/);
    expect(() =>
      parseFlowFile(withMatrix("{ viewports: [{ name: 'My Phone', width: 390, height: 844 }] }")),
    ).toThrow(FlowFileError);
  });

  it("rejects duplicate locales (ignoring case) and duplicate viewport names", () => {
    expect(() => parseFlowFile(withMatrix("{ locales: [en-US, en-us] }"))).toThrow(
      /duplicate entries/,
    );
    expect(() => parseFlowFile(withMatrix("{ viewports: [mobile, mobile] }"))).toThrow(
      /duplicate entries: "mobile"/,
    );
    expect(() =>
      parseFlowFile(
        withMatrix("{ viewports: [{ name: mobile, width: 400, height: 800 }, mobile] }"),
      ),
    ).toThrow(/duplicate entries/);
  });
});

describe("only/skip validation", () => {
  const flowWith = (
    stepExtra: string,
    matrix = "{ viewports: [mobile, tablet], locales: [en-US, es-ES] }",
  ) =>
    `name: f\nmatrix: ${matrix}\nsteps:\n  - id: a\n    action: wait\n  - id: b\n    action: wait\n${stepExtra}`;

  it("rejects a viewport name the matrix does not have, naming the step and the valid names", () => {
    expect(() => parseFlowFile(flowWith("    only: { viewport: [phone] }\n"))).toThrow(
      /step "b" `only`: viewport "phone" is not in the matrix \(mobile, tablet\)/,
    );
  });

  it("rejects an axis the matrix does not have", () => {
    expect(() => parseFlowFile(flowWith("    skip: { color_scheme: [dark] }\n"))).toThrow(
      /names `color_scheme` but the matrix has no `color_schemes`/,
    );
  });

  it("rejects a locale no matrix locale matches, and accepts a language for its region", () => {
    expect(() => parseFlowFile(flowWith("    only: { locale: [de] }\n"))).toThrow(
      /locale "de" is not in the matrix/,
    );
    const ok = parseFlowFile(flowWith("    only: { locale: [es] }\n"));
    const ids = expandFlowVariants(ok)
      .filter((v) => stepIds(v.flow).includes("b"))
      .map((v) => v.id);
    expect(ids).toEqual(["es-ES.mobile", "es-ES.tablet"]);
  });

  it("checks annotation selectors too", () => {
    expect(() =>
      parseFlowFile(flowWith("    annotation: { copy: x, skip: { viewport: [phone] } }\n")),
    ).toThrow(/step "b" annotation `skip`/);
  });

  it("AND across axes in one clause, OR within a list", () => {
    const flow = parseFlowFile(
      flowWith("    only: { viewport: [mobile, tablet], locale: [en-US] }\n"),
    );
    const withB = expandFlowVariants(flow)
      .filter((v) => stepIds(v.flow).includes("b"))
      .map((v) => v.id);
    expect(withB).toEqual(["en-US.mobile", "en-US.tablet"]);
  });

  it("only and skip together: kept when only matches and skip does not", () => {
    const flow = parseFlowFile(
      flowWith("    only: { locale: [en-US] }\n    skip: { viewport: [tablet] }\n"),
    );
    const withB = expandFlowVariants(flow)
      .filter((v) => stepIds(v.flow).includes("b"))
      .map((v) => v.id);
    expect(withB).toEqual(["en-US.mobile"]);
  });

  it("rejects a variant left with no steps", () => {
    const src = `name: f\nmatrix: { color_schemes: [light, dark] }\nsteps:\n  - id: a\n    action: wait\n    only: { color_scheme: [dark] }\n`;
    expect(() => parseFlowFile(src)).toThrow(/variant "light" has no steps left/);
  });

  it("rejects an empty selector", () => {
    expect(() => parseFlowFile(flowWith("    only: {}\n"))).toThrow(/name at least one/);
  });
});

describe("matrix with extends", () => {
  const PARENT = `
name: base
locators: { x: '#x' }
matrix: { color_schemes: [light, dark] }
steps:
  - id: p
    action: click
    target: $x
`;
  const CHILD = `
name: child
extends: base
matrix: { viewports: [mobile] }
steps:
  - id: c
    action: wait
    only: { viewport: [mobile] }
`;
  const load = (name: string) => parseFlowFile(name === "base" ? PARENT : CHILD);

  it("uses the child's matrix only; the parent's is not inherited", async () => {
    const merged = await resolveFlowExtends(parseFlowFile(CHILD), load);
    expect(merged.matrix).toEqual({ viewports: ["mobile"] });
    expect(expandFlowVariants(merged).map((v) => v.id)).toEqual(["mobile"]);
  });

  it("a child without a matrix has none, even when its parent has one", async () => {
    const child = parseFlowFile(
      `name: plain\nextends: base\nsteps:\n  - id: c\n    action: wait\n`,
    );
    const merged = await resolveFlowExtends(child, load);
    expect(merged.matrix).toBeUndefined();
    expect(expandFlowVariants(merged)[0]!.id).toBeNull();
  });

  it("checks a parent step's only/skip against the child's matrix once merged", async () => {
    const parent = `
name: base2
locators: { x: '#x' }
matrix: { color_schemes: [light, dark] }
steps:
  - id: p
    action: click
    target: $x
    only: { color_scheme: [dark] }
  - id: q
    action: wait
`;
    const child = parseFlowFile(
      `name: child2\nextends: base2\nmatrix: { viewports: [mobile] }\nsteps:\n  - id: c\n    action: wait\n`,
    );
    const merged = await resolveFlowExtends(child, () => parseFlowFile(parent));
    expect(() => expandFlowVariants(merged)).toThrow(
      /names `color_scheme` but the matrix has no `color_schemes`/,
    );
  });
});

describe("copy lookup", () => {
  const ann = (by: Record<string, string>) => ({ copy: "fallback", copy_by_locale: by });

  it("takes the exact tag before the language, then falls back to copy", () => {
    const a = ann({ "es-ES": "exacto", es: "idioma" });
    expect(pickCopy(a, "es-ES")).toBe("exacto");
    expect(pickCopy(a, "es-MX")).toBe("idioma");
    expect(pickCopy(a, "fr-FR")).toBe("fallback");
    expect(pickCopy(a, undefined)).toBe("fallback");
    expect(pickCopy({ copy: "plain" }, "es-ES")).toBe("plain");
  });

  it("ignores case in tags", () => {
    expect(pickCopy(ann({ "ES-es": "x" }), "es-ES")).toBe("x");
  });

  it("matches a locale by language", () => {
    expect(localeMatches("es", "es-ES")).toBe(true);
    expect(localeMatches("es-ES", "es-ES")).toBe(true);
    expect(localeMatches("es-ES", "es")).toBe(false);
    expect(localeMatches("e", "es-ES")).toBe(false);
  });
});
