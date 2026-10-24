// schemas/pack-config-1.schema.json against `parsePackConfig`: the schema accepts and rejects the
// same pack.json documents, its patterns are the parser's, and the rules a schema cannot say are
// pinned as known differences.

import { describe, expect, it } from "vitest";
import { CAPTURE_FLOW } from "../src/pack-matrix.js";
import { ID_PATTERN } from "../src/pack-schema.js";
import { PACK_CONFIG_SCHEMA, parsePackConfig } from "../src/pack-workspace.js";
import { checkSchema, edited, readSchema } from "./helpers/json-schema-check.js";

const schema = readSchema("pack-config-1.schema.json");
const defs = schema.$defs as Record<string, Record<string, unknown>>;
const packSchema = readSchema("screens-pack-2.schema.json");

type Doc = Record<string, unknown>;

function goodConfig(): Doc {
  return {
    schema: PACK_CONFIG_SCHEMA,
    sources: {
      "desktop-1280": { flow: "app", variant: "en.dark.1280" },
      "login-desktop": {
        flow: "login",
        matrix: "en-US.light.desktop-1280",
        variant: "en.light.1280",
      },
    },
    matrixFlow: {
      flow: "checkout",
      auto: true,
      map: { "en-US.dark.desktop-1280": "en.dark.1280" },
    },
    flows: {
      app: {
        title: { en: "App" },
        steps: { board: { alt: { en: "Board" }, caption: { en: "Board" } } },
      },
      login: { steps: { form: { alt: { en: "Login form" } } } },
    },
  };
}

type Edit = (c: Doc) => Doc;
const set =
  (path: (string | number)[], value: unknown): Edit =>
  (c) =>
    edited(c, path, value);
const all =
  (...edits: Edit[]): Edit =>
  (c) =>
    edits.reduce((acc, edit) => edit(acc), c);
const LOGIN = ["sources", "login-desktop"];
const MATRIX = ["matrixFlow"];
const APP = ["flows", "app"];
const noSources = set(["sources"], undefined);
const noMatrixFlow = set(MATRIX, undefined);

const cases: [string, Edit, boolean][] = [
  ["the good fixture", (c) => c, true],
  ["another schema id", set(["schema"], "docsxai/pack-config@2"), false],
  ["no schema key", set(["schema"], undefined), false],
  ["an unknown root key", set(["notes"], "x"), true],
  ["matrixFlow without sources", noSources, true],
  ["sources without matrixFlow", noMatrixFlow, true],
  ["neither sources nor matrixFlow", all(noSources, noMatrixFlow), false],
  ["empty sources with matrixFlow", set(["sources"], {}), true],
  ["empty sources without matrixFlow", all(set(["sources"], {}), noMatrixFlow), false],
  ["sources as an array", set(["sources"], []), false],
  ["sources as null", set(["sources"], null), false],
  [
    "a source named constructor",
    set(["sources", "constructor"], { flow: "app", variant: "en.dark.390" }),
    false,
  ],
  [
    "a source named prototype",
    set(["sources", "prototype"], { flow: "app", variant: "en.dark.390" }),
    false,
  ],
  [
    "a source named __proto__",
    set(["sources", "__proto__"], { flow: "app", variant: "en.dark.390" }),
    false,
  ],
  [
    "a source name with a space",
    set(["sources", "my flow"], { flow: "app", variant: "en.dark.390" }),
    false,
  ],
  [
    "a source name starting with a dot",
    set(["sources", ".hidden"], { flow: "app", variant: "en.dark.390" }),
    false,
  ],
  [
    "a source name with capitals and dots",
    set(["sources", "Desk.top_1"], { flow: "app", variant: "en.dark.390" }),
    true,
  ],
  ["a source entry that is a string", set(["sources", "desktop-1280"], "app"), false],
  ["an unknown key on a source", set(["sources", "desktop-1280", "note"], "x"), true],
  ["a flat source flow in capitals", set(["sources", "desktop-1280", "flow"], "App"), false],
  [
    "a flat source flow of 65 characters",
    set(["sources", "desktop-1280", "flow"], `a${"b".repeat(64)}`),
    false,
  ],
  ["a flat source without flow", set(["sources", "desktop-1280", "flow"], undefined), false],
  ["a flat source without variant", set(["sources", "desktop-1280", "variant"], undefined), false],
  [
    "a flat source variant with two parts",
    set(["sources", "desktop-1280", "variant"], "en.dark"),
    false,
  ],
  [
    "a flat source variant with a theme in capitals",
    set(["sources", "desktop-1280", "variant"], "en.Dark.390"),
    false,
  ],
  ["a flat source entry without matrix", set([...LOGIN, "matrix"], undefined), true],
  ["a matrix source variant that is wrong", set([...LOGIN, "variant"], "en.light"), false],
  ["a matrix id named screenshots", set([...LOGIN, "matrix"], "screenshots"), false],
  ["a matrix id with a space", set([...LOGIN, "matrix"], "en US"), false],
  ["a matrix id that is a number", set([...LOGIN, "matrix"], 3), false],
  [
    "a matrix source flow that is not a pack id, no packFlow",
    set([...LOGIN, "flow"], "Login_Page"),
    false,
  ],
  [
    "a matrix source flow that is not a pack id, with packFlow",
    all(set([...LOGIN, "flow"], "Login_Page"), set([...LOGIN, "packFlow"], "login")),
    true,
  ],
  ["a matrix source packFlow that is not a pack id", set([...LOGIN, "packFlow"], "Login"), false],
  ["a matrix source flow with a space", set([...LOGIN, "flow"], "log in"), false],
  ["matrixFlow as null", set(MATRIX, null), false],
  [
    "matrixFlow with map and no auto",
    set(MATRIX, { flow: "checkout", map: { "en-US.dark.desktop-1280": "en.dark.1280" } }),
    true,
  ],
  ["matrixFlow with auto and no map", set(MATRIX, { flow: "checkout", auto: true }), true],
  ["matrixFlow with neither map nor auto", set(MATRIX, { flow: "checkout" }), false],
  ["matrixFlow with auto false and no map", set(MATRIX, { flow: "checkout", auto: false }), false],
  [
    "matrixFlow with auto false and a map",
    set(MATRIX, {
      flow: "checkout",
      auto: false,
      map: { "en-US.dark.desktop-1280": "en.dark.1280" },
    }),
    true,
  ],
  ["matrixFlow with auto as a string", set([...MATRIX, "auto"], "yes"), false],
  ["matrixFlow with an empty map and no auto", set(MATRIX, { flow: "checkout", map: {} }), false],
  ["matrixFlow with a map as an array", set([...MATRIX, "map"], []), false],
  [
    "matrixFlow map key named screenshots",
    set([...MATRIX, "map", "screenshots"], "en.dark.1280"),
    false,
  ],
  [
    "matrixFlow map value that is wrong",
    set([...MATRIX, "map", "en-US.dark.desktop-1280"], "en.dark"),
    false,
  ],
  ["matrixFlow without flow", set([...MATRIX, "flow"], undefined), false],
  ["matrixFlow flow with a space", set([...MATRIX, "flow"], "check out"), false],
  [
    "matrixFlow flow that is not a pack id, no packFlow",
    set([...MATRIX, "flow"], "Checkout_Page"),
    false,
  ],
  [
    "matrixFlow flow that is not a pack id, with packFlow",
    all(set([...MATRIX, "flow"], "Checkout_Page"), set([...MATRIX, "packFlow"], "checkout")),
    true,
  ],
  ["matrixFlow packFlow that is not a pack id", set([...MATRIX, "packFlow"], "Checkout"), false],
  ["no flows", set(["flows"], undefined), false],
  ["flows as an array", set(["flows"], []), false],
  ["empty flows", set(["flows"], {}), true],
  [
    "a flow id in capitals (the pack validator checks ids)",
    set(["flows", "App"], { steps: {} }),
    true,
  ],
  ["a flow without steps", set([...APP, "steps"], undefined), false],
  ["a flow with steps as an array", set([...APP, "steps"], []), false],
  ["a flow with empty steps", set([...APP, "steps"], {}), true],
  ["a step without alt", set([...APP, "steps", "board", "alt"], undefined), false],
  ["a step with alt as a string", set([...APP, "steps", "board", "alt"], "Board"), false],
  [
    "a step with an empty alt (the pack validator checks it)",
    set([...APP, "steps", "board", "alt"], {}),
    true,
  ],
  ["a step with alt text that is a number", set([...APP, "steps", "board", "alt", "en"], 5), false],
  ["a step with caption as a string", set([...APP, "steps", "board", "caption"], "Board"), false],
  ["a title as a string", set([...APP, "title"], "App"), false],
  ["a title with text that is a number", set([...APP, "title", "en"], 5), false],
];

describe("pack-config-1.schema.json agrees with parsePackConfig", () => {
  it.each(cases)("%s", (_name, edit, valid) => {
    const doc = edit(goodConfig());
    let parsed = true;
    try {
      parsePackConfig(doc);
    } catch {
      parsed = false;
    }
    expect(parsed).toBe(valid);
    expect(checkSchema(schema, doc).length === 0).toBe(valid);
  });
});

describe("pack-config-1.schema.json uses the parser's constants", () => {
  it("names the id and the draft", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://docsxai.dev/schemas/pack-config-1.json");
    expect((schema.properties as Doc).schema).toEqual({ const: PACK_CONFIG_SCHEMA });
  });

  it("copies the flow id, capture flow and variant key patterns", () => {
    expect(defs.id!.pattern).toBe(ID_PATTERN.source);
    expect(defs.captureFlow!.pattern).toBe(CAPTURE_FLOW.source);
    const packDefs = packSchema.$defs as Record<string, Record<string, unknown>>;
    expect(defs.variantKey!.pattern).toBe(packDefs.variantKey!.pattern);
    expect(defs.id!.maxLength).toBe(packDefs.id!.maxLength);
  });
});

describe("rules the schema cannot say", () => {
  it("two source names that differ only by case", () => {
    const doc = set(["sources"], {
      Desktop: { flow: "app", variant: "en.dark.1280" },
      desktop: { flow: "app", variant: "en.dark.390" },
    })(goodConfig());
    expect(checkSchema(schema, doc)).toEqual([]);
    expect(() => parsePackConfig(doc)).toThrow(/differ only by case/);
  });

  it("a matrixFlow map of null, which the parser reads as an empty map", () => {
    const doc = set([...MATRIX, "map"], null)(goodConfig());
    expect(() => parsePackConfig(doc)).not.toThrow();
    expect(checkSchema(schema, doc)).not.toEqual([]);
  });
});
