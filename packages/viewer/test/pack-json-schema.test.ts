// schemas/screens-pack-2.schema.json against the real validator: the schema accepts and rejects the
// same documents as `validatePack`, its patterns and limits are the validator's constants, and the
// rules a schema cannot say (listed in docs/pack-manifest.md) are pinned as known differences.

import { describe, expect, it } from "vitest";
import {
  HASH8_PATTERN,
  ID_MAX,
  ID_PATTERN,
  LOCALE_PATTERN,
  SCREENS_PACK_SCHEMA,
  THEME_PATTERN,
  VIEWPORT_PATTERN,
  parseVariantKey,
  type ScreensPack,
} from "../src/pack-schema.js";
import { MAX_COPY, MAX_TEXT, MAX_TITLE, validatePack } from "../src/pack-validate.js";
import { checkSchema, edited, readSchema } from "./helpers/json-schema-check.js";

const schema = readSchema("screens-pack-2.schema.json");
const defs = schema.$defs as Record<string, Record<string, unknown>>;

function goodPack(): ScreensPack {
  return {
    schema: SCREENS_PACK_SCHEMA,
    generated_for: "a1b2c3d",
    flows: {
      login: {
        title: { en: "Sign in", es: "Entrar" },
        steps: {
          home: {
            caption: { en: "The sign-in page" },
            alt: { en: "Sign-in page", es: "Pagina de entrada", "pt-BR": "Pagina de entrada" },
            variants: {
              "en.light.1280": {
                src: "/screens/login/home.3fa9c1d2.png",
                width: 1280,
                height: 800,
                bytes: 48213,
                callouts: [
                  {
                    index: 1,
                    copy: "Enter your email",
                    bbox: { x: 0, y: 220, width: 320, height: 4.5 },
                  },
                  { index: 2, copy: "Continue" },
                ],
              },
              "es.dark.390": {
                src: "/screens/login/home.89abcdef.png",
                width: 390,
                height: 844,
                bytes: 1,
                callouts: [],
              },
            },
          },
        },
      },
    },
  };
}

const STEP = ["flows", "login", "steps", "home"];
const VARIANT = [...STEP, "variants", "en.light.1280"];
const CALLOUT = [...VARIANT, "callouts", 0];
const BBOX = [...CALLOUT, "bbox"];
const variantOf = (src: string) => ({ src, width: 10, height: 10, bytes: 10, callouts: [] });
const many = (n: number, make: (i: number) => unknown): Record<string, unknown> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, make(i)]));

type Path = (string | number)[];
// [name, path, replacement (undefined removes the key), whether the document is valid]
const cases: [string, Path, unknown, boolean][] = [
  ["the good fixture", ["generated_for"], "a1b2c3d", true],
  ["no generated_for", ["generated_for"], undefined, true],
  ["no caption", [...STEP, "caption"], undefined, true],
  ["no title", ["flows", "login", "title"], undefined, true],
  ["no bbox", [...CALLOUT, "bbox"], undefined, true],
  ["another schema id", ["schema"], "docsxai/screens-pack@1", false],
  ["no schema key", ["schema"], undefined, false],
  ["a timestamp at the root", ["generated_at"], "2026-10-24", false],
  ["generated_for of 129 characters", ["generated_for"], "x".repeat(129), false],
  ["generated_for of 128 characters", ["generated_for"], "x".repeat(128), true],
  ["blank generated_for", ["generated_for"], "   ", false],
  ["flows as an array", ["flows"], [], false],
  ["no flows", ["flows"], {}, false],
  ["201 flows", ["flows"], many(201, () => ({ steps: {} })), false],
  ["flow id in capitals", ["flows"], { Login: { steps: {} } }, false],
  ["flow id with a dot", ["flows"], { "log.in": { steps: {} } }, false],
  ["flow id of 65 characters", ["flows"], { [`a${"b".repeat(64)}`]: { steps: {} } }, false],
  ["an unknown key on a flow", ["flows", "login", "seo"], true, false],
  [
    "title text of 201 characters",
    ["flows", "login", "title", "en"],
    "x".repeat(MAX_TITLE + 1),
    false,
  ],
  ["title text of 200 characters", ["flows", "login", "title", "en"], "x".repeat(MAX_TITLE), true],
  ["empty title", ["flows", "login", "title"], {}, false],
  ["no steps", ["flows", "login", "steps"], undefined, false],
  ["empty steps", ["flows", "login", "steps"], {}, false],
  [
    "step id with a dot",
    ["flows", "login", "steps"],
    { "a.b": goodPack().flows.login!.steps.home },
    false,
  ],
  ["no alt", [...STEP, "alt"], undefined, false],
  ["empty alt", [...STEP, "alt"], {}, false],
  ["alt locale in capitals", [...STEP, "alt"], { EN: "x" }, false],
  ["alt locale of one letter", [...STEP, "alt"], { e: "x" }, false],
  ["alt text blank", [...STEP, "alt", "en"], " \n ", false],
  ["alt text a number", [...STEP, "alt", "en"], 7, false],
  ["alt text of 1001 characters", [...STEP, "alt", "en"], "x".repeat(MAX_TEXT + 1), false],
  ["alt text of 1000 characters", [...STEP, "alt", "en"], "x".repeat(MAX_TEXT), true],
  ["caption text of 1001 characters", [...STEP, "caption", "en"], "x".repeat(MAX_TEXT + 1), false],
  ["an unknown key on a step", [...STEP, "notes"], "x", false],
  ["no variants", [...STEP, "variants"], undefined, false],
  ["empty variants", [...STEP, "variants"], {}, false],
  [
    "a variant key with two parts",
    [...STEP, "variants"],
    { "en.light": variantOf("/screens/login/home.3fa9c1d2.png") },
    false,
  ],
  [
    "a variant key with four parts",
    [...STEP, "variants"],
    { "en.light.1280.x": variantOf("/screens/login/home.3fa9c1d2.png") },
    false,
  ],
  [
    "a variant key with theme in capitals",
    [...STEP, "variants"],
    { "en.Light.1280": variantOf("/screens/login/home.3fa9c1d2.png") },
    false,
  ],
  [
    "a variant key with a two digit viewport",
    [...STEP, "variants"],
    { "en.light.99": variantOf("/screens/login/home.3fa9c1d2.png") },
    false,
  ],
  [
    "a variant key with a leading zero viewport",
    [...STEP, "variants"],
    { "en.light.0800": variantOf("/screens/login/home.3fa9c1d2.png") },
    false,
  ],
  [
    "a variant key with a regional locale",
    [...STEP, "variants"],
    { "pt-BR.light.1280": variantOf("/screens/login/home.3fa9c1d2.png") },
    true,
  ],
  [
    "65 variants",
    [...STEP, "variants"],
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `en.light.${1000 + i}`,
        variantOf("/screens/login/home.3fa9c1d2.png"),
      ]),
    ),
    false,
  ],
  [
    "64 variants",
    [...STEP, "variants"],
    Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [
        `en.light.${1000 + i}`,
        variantOf("/screens/login/home.3fa9c1d2.png"),
      ]),
    ),
    true,
  ],
  ["a src with another hash length", [...VARIANT, "src"], "/screens/login/home.3fa9c1d.png", false],
  ["a src with an upper case hash", [...VARIANT, "src"], "/screens/login/home.3FA9C1D2.png", false],
  ["a src that is not a png", [...VARIANT, "src"], "/screens/login/home.3fa9c1d2.jpg", false],
  ["a src without a prefix slash", [...VARIANT, "src"], "screens/login/home.3fa9c1d2.png", false],
  ["a src at the site root", [...VARIANT, "src"], "/login/home.3fa9c1d2.png", true],
  ["a src with a nested prefix", [...VARIANT, "src"], "/a/b/c/login/home.3fa9c1d2.png", true],
  ["a src with a parent segment", [...VARIANT, "src"], "/../login/home.3fa9c1d2.png", false],
  ["a src that is a number", [...VARIANT, "src"], 5, false],
  ["width 0", [...VARIANT, "width"], 0, false],
  ["width 20000", [...VARIANT, "width"], 20000, true],
  ["width 20001", [...VARIANT, "width"], 20001, false],
  ["a fractional height", [...VARIANT, "height"], 800.5, false],
  ["height as a string", [...VARIANT, "height"], "800", false],
  ["bytes 0", [...VARIANT, "bytes"], 0, false],
  ["bytes at the safe integer limit", [...VARIANT, "bytes"], Number.MAX_SAFE_INTEGER, true],
  ["no bytes", [...VARIANT, "bytes"], undefined, false],
  ["no callouts key", [...VARIANT, "callouts"], undefined, false],
  ["callouts as an object", [...VARIANT, "callouts"], {}, false],
  [
    "51 callouts",
    [...VARIANT, "callouts"],
    Array.from({ length: 51 }, (_, i) => ({ index: (i % 50) + 1, copy: "x" })),
    false,
  ],
  [
    "50 distinct callouts",
    [...VARIANT, "callouts"],
    Array.from({ length: 50 }, (_, i) => ({ index: i + 1, copy: "x" })),
    true,
  ],
  ["an unknown key on a variant", [...VARIANT, "etag"], "x", false],
  ["callout index 0", [...CALLOUT, "index"], 0, false],
  ["callout index 51", [...CALLOUT, "index"], 51, false],
  ["a fractional callout index", [...CALLOUT, "index"], 1.5, false],
  ["no callout index", [...CALLOUT, "index"], undefined, false],
  ["empty callout copy", [...CALLOUT, "copy"], "", false],
  ["callout copy of 501 characters", [...CALLOUT, "copy"], "x".repeat(MAX_COPY + 1), false],
  ["callout copy of 500 characters", [...CALLOUT, "copy"], "x".repeat(MAX_COPY), true],
  ["an unknown key on a callout", [...CALLOUT, "arrow"], "left", false],
  ["bbox as an array", BBOX, [0, 0, 1, 1], false],
  ["bbox x below 0", [...BBOX, "x"], -1, false],
  ["bbox y below 0", [...BBOX, "y"], -0.5, false],
  ["bbox width 0", [...BBOX, "width"], 0, false],
  ["bbox height below 0", [...BBOX, "height"], -3, false],
  ["bbox without height", [...BBOX, "height"], undefined, false],
  ["an unknown key on a bbox", [...BBOX, "z"], 1, false],
];

describe("screens-pack-2.schema.json agrees with validatePack", () => {
  it("accepts the good fixture", () => {
    expect(validatePack(goodPack()).errors).toEqual([]);
    expect(checkSchema(schema, goodPack())).toEqual([]);
  });

  it.each(cases)("%s", (_name, path, value, valid) => {
    const doc = edited(goodPack(), path, value);
    expect(validatePack(doc).ok).toBe(valid);
    expect(checkSchema(schema, doc).length === 0).toBe(valid);
  });

  it("rejects values that are not objects", () => {
    for (const doc of [null, [], "pack", 3]) {
      expect(validatePack(doc).ok).toBe(false);
      expect(checkSchema(schema, doc)).not.toEqual([]);
    }
  });
});

describe("screens-pack-2.schema.json uses the validator's constants", () => {
  it("names the id and the draft", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://docsxai.dev/schemas/screens-pack-2.json");
    expect((schema.properties as Record<string, unknown>).schema).toEqual({
      const: SCREENS_PACK_SCHEMA,
    });
  });

  it("copies the id, locale and key patterns", () => {
    expect(defs.id!.pattern).toBe(ID_PATTERN.source);
    expect(defs.id!.maxLength).toBe(ID_MAX);
    expect(defs.locale!.pattern).toBe(LOCALE_PATTERN.source);
    const key = new RegExp(defs.variantKey!.pattern as string, "u");
    const probes = [
      "en.light.1280",
      "pt-BR.dark.390",
      "en.light.99",
      "en.Light.1280",
      "en..1280",
      "e.light.1280",
      "en.light.1280.x",
      "en-US-x-9.light.0800",
    ];
    for (const probe of probes)
      expect(key.test(probe), probe).toBe(parseVariantKey(probe) !== null);
    const inner = (re: RegExp) => re.source.slice(1, -1);
    expect(defs.variantKey!.pattern).toBe(
      `^${inner(LOCALE_PATTERN)}\\.${inner(THEME_PATTERN)}\\.${inner(VIEWPORT_PATTERN)}$`,
    );
    const src = defs.variant as unknown as { properties: { src: { pattern: string } } };
    expect(src.properties.src.pattern).toContain(`\\.${inner(HASH8_PATTERN)}\\.png$`);
  });

  it("copies the text limits", () => {
    expect(defs.text128!.maxLength).toBe(128);
    expect(defs.text200!.maxLength).toBe(MAX_TITLE);
    expect(defs.text500!.maxLength).toBe(MAX_COPY);
    expect(defs.text1000!.maxLength).toBe(MAX_TEXT);
  });
});

describe("rules the schema cannot say", () => {
  const rejectedOnlyByValidator = (doc: unknown, opts?: { publicPrefix?: string }) => {
    expect(checkSchema(schema, doc)).toEqual([]);
    expect(validatePack(doc, opts).ok).toBe(false);
  };

  it("a callout index repeated within a variant", () => {
    rejectedOnlyByValidator(edited(goodPack(), [...CALLOUT.slice(0, -1), 1, "index"], 1));
  });

  it("an alt that lacks a locale one of the variants uses", () => {
    rejectedOnlyByValidator(edited(goodPack(), [...STEP, "alt"], { en: "Sign-in page" }));
  });

  it("a src whose flow or step differs from the keys around it", () => {
    rejectedOnlyByValidator(
      edited(goodPack(), [...VARIANT, "src"], "/screens/other/home.3fa9c1d2.png"),
    );
    rejectedOnlyByValidator(
      edited(goodPack(), [...VARIANT, "src"], "/screens/login/away.3fa9c1d2.png"),
    );
  });

  it("a src outside the public prefix the caller passes", () => {
    rejectedOnlyByValidator(goodPack(), { publicPrefix: "/docs/img" });
  });

  it("text length counts UTF-16 units in the validator and code points in the schema", () => {
    rejectedOnlyByValidator(edited(goodPack(), [...CALLOUT, "copy"], "\u{1F600}".repeat(300)));
  });
});
