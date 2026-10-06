import { describe, expect, it } from "vitest";
import {
  SCREENS_PACK_SCHEMA,
  fileOfSrc,
  normalisePublicPrefix,
  parseVariantKey,
  serialisePack,
  type ScreensPack,
} from "../src/pack-schema.js";
import { assertValidPack, validatePack } from "../src/pack-validate.js";

function validPack(): ScreensPack {
  return {
    schema: SCREENS_PACK_SCHEMA,
    generated_for: "abc123",
    flows: {
      onboarding: {
        title: { en: "Onboarding", es: "Primeros pasos" },
        steps: {
          pair_host: {
            caption: { en: "Pair a host" },
            alt: { en: "Pairing screen", es: "Pantalla de emparejado" },
            variants: {
              "en.light.390": {
                src: "/screens/onboarding/pair_host.0123abcd.png",
                width: 390,
                height: 844,
                bytes: 12345,
                callouts: [
                  {
                    index: 1,
                    copy: "Scan the code",
                    bbox: { x: 10, y: 20, width: 30, height: 40 },
                  },
                  { index: 2, copy: "Confirm" },
                ],
              },
              "es.dark.1280": {
                src: "/screens/onboarding/pair_host.89abcdef.png",
                width: 1280,
                height: 800,
                bytes: 99,
                callouts: [],
              },
            },
          },
        },
      },
    },
  };
}

const errorsOf = (value: unknown, publicPrefix?: string) =>
  validatePack(value, publicPrefix === undefined ? {} : { publicPrefix }).errors;

/** Applies `edit` to a fresh copy and returns the validator's errors. */
function errorsAfter(edit: (p: ScreensPack) => void, publicPrefix?: string): string[] {
  const pack = validPack();
  edit(pack);
  return errorsOf(pack, publicPrefix);
}

const step = (p: ScreensPack) => p.flows.onboarding!.steps.pair_host!;
const variant = (p: ScreensPack, key = "en.light.390") => step(p).variants[key]!;

describe("validatePack accepts", () => {
  it("a full pack", () => {
    expect(validatePack(validPack())).toEqual({ ok: true, errors: [] });
  });

  it("a pack with no generated_for, title or caption", () => {
    const pack = validPack();
    delete pack.generated_for;
    delete pack.flows.onboarding!.title;
    delete step(pack).caption;
    expect(errorsOf(pack)).toEqual([]);
  });

  it("locales, themes and viewports beyond en/es, light/dark and 390/1280", () => {
    const pack = validPack();
    const s = step(pack);
    s.alt = { ...s.alt, "pt-BR": "Tela de pareamento", ja: "ペアリング" };
    s.variants["pt-BR.sepia.768"] = {
      ...variant(pack),
      src: "/screens/onboarding/pair_host.00000000.png",
    };
    s.variants["ja.high-contrast.1920"] = {
      ...variant(pack),
      src: "/screens/onboarding/pair_host.11111111.png",
    };
    expect(errorsOf(pack)).toEqual([]);
  });

  it("a prefix other than /screens, or none, when the caller names it", () => {
    const pack = validPack();
    variant(pack).src = "/img/docs/onboarding/pair_host.0123abcd.png";
    variant(pack, "es.dark.1280").src = "/img/docs/onboarding/pair_host.89abcdef.png";
    expect(errorsOf(pack, "/img/docs")).toEqual([]);
    expect(errorsOf(pack)).toEqual([]);
    variant(pack).src = "/onboarding/pair_host.0123abcd.png";
    variant(pack, "es.dark.1280").src = "/onboarding/pair_host.89abcdef.png";
    expect(errorsOf(pack, "")).toEqual([]);
  });
});

describe("validatePack rejects", () => {
  it("a value that is not an object, and the wrong schema id", () => {
    expect(errorsOf(null)).toEqual(["pack: expected an object"]);
    expect(errorsOf([])).toEqual(["pack: expected an object"]);
    expect(
      errorsAfter((p) => ((p as unknown as { schema: string }).schema = "docsxai/screens-pack@1")),
    ).toEqual(['pack.schema: expected "docsxai/screens-pack@2"']);
  });

  it("unknown keys at every level, so a timestamp cannot slip in", () => {
    const pack = validPack();
    const loose = (v: unknown) => v as Record<string, unknown>;
    loose(pack).generated_at = "2026-01-01T00:00:00Z";
    loose(pack.flows.onboarding).updated = 1;
    loose(step(pack)).note = "x";
    loose(variant(pack)).mtime = 1;
    loose(variant(pack).callouts[0]).color = "red";
    loose(variant(pack).callouts[0]!.bbox).z = 1;
    expect(errorsOf(pack)).toEqual([
      'pack: unknown key "generated_at"',
      'pack.flows["onboarding"]: unknown key "updated"',
      'pack.flows["onboarding"].steps["pair_host"]: unknown key "note"',
      'pack.flows["onboarding"].steps["pair_host"].variants["en.light.390"]: unknown key "mtime"',
      'pack.flows["onboarding"].steps["pair_host"].variants["en.light.390"].callouts[0]: unknown key "color"',
      'pack.flows["onboarding"].steps["pair_host"].variants["en.light.390"].callouts[0].bbox: unknown key "z"',
    ]);
  });

  it("no flows, no steps, no variants", () => {
    expect(errorsAfter((p) => (p.flows = {}))).toEqual(["pack.flows: expected 1 to 200 flows"]);
    expect(errorsAfter((p) => (p.flows.onboarding!.steps = {}))).toEqual([
      'pack.flows["onboarding"].steps: expected 1 to 500 steps',
    ]);
    expect(errorsAfter((p) => (step(p).variants = {}))[0]).toMatch(
      /variants: expected 1 to 64 variants/,
    );
  });

  it.each(["Onboarding", "first.run", "-lead", "trail-", "a--b", "", "x".repeat(65)])(
    "the flow id %j",
    (id) => {
      const errors = errorsAfter((p) => {
        p.flows[id] = p.flows.onboarding!;
        delete p.flows.onboarding;
      });
      expect(errors.join("\n")).toMatch(/flow id must match/);
    },
  );

  it("a step id with a dot or an uppercase letter", () => {
    for (const id of ["pair.host", "Pair"]) {
      const errors = errorsAfter((p) => {
        p.flows.onboarding!.steps[id] = step(p);
        delete p.flows.onboarding!.steps.pair_host;
      });
      expect(errors.join("\n")).toMatch(/step id must match/);
    }
  });

  it.each([
    "en.light",
    "en.light.390.x",
    "EN.light.390",
    "en.Light.390",
    "en.light.12",
    "en.light.12345",
    "e.light.390",
    "en..390",
  ])("the variant key %j", (key) => {
    const errors = errorsAfter((p) => {
      step(p).variants[key] = variant(p);
    });
    expect(errors.join("\n")).toContain(`"${key}" is not <locale>.<theme>.<viewport>`);
  });

  it("a variant whose locale alt does not cover", () => {
    const errors = errorsAfter((p) => (step(p).alt = { en: "Pairing screen" }));
    expect(errors).toEqual([
      'pack.flows["onboarding"].steps["pair_host"].alt: no text for locale "es" used by variant "es.dark.1280"',
    ]);
  });

  it("empty, blank and over-long text, and a bad locale tag", () => {
    expect(errorsAfter((p) => (step(p).alt = { en: "", es: "ok" })).join("\n")).toMatch(
      /alt\.en: expected a non-empty string/,
    );
    expect(errorsAfter((p) => (step(p).alt.en = "   ")).join("\n")).toMatch(/alt\.en/);
    expect(errorsAfter((p) => (step(p).alt.en = "x".repeat(1001))).join("\n")).toMatch(
      /at most 1000/,
    );
    expect(errorsAfter((p) => (variant(p).callouts[0]!.copy = "x".repeat(501))).join("\n")).toMatch(
      /copy: .*at most 500/,
    );
    expect(errorsAfter((p) => (p.flows.onboarding!.title = { "EN-us": "x" })).join("\n")).toMatch(
      /"EN-us" is not a locale tag/,
    );
    expect(errorsAfter((p) => (step(p).alt = {})).join("\n")).toMatch(
      /expected at least one locale/,
    );
  });

  it.each([
    "/screens/onboarding/pair_host.png",
    "/screens/onboarding/pair_host.0123ABCD.png",
    "/screens/onboarding/pair_host.0123abc.png",
    "/screens/onboarding/pair_host.0123abcd.jpg",
    "/screens/other/pair_host.0123abcd.png",
    "/screens/onboarding/other.0123abcd.png",
    "/screens/../etc/onboarding/pair_host.0123abcd.png",
    "screens/onboarding/pair_host.0123abcd.png",
    "https://cdn.example.com/screens/onboarding/pair_host.0123abcd.png",
  ])("the src %j", (src) => {
    const errors = errorsAfter((p) => (variant(p).src = src));
    expect(errors.join("\n")).toMatch(
      /\.src: expected <public-prefix>\/onboarding\/pair_host\.<8 hex chars>\.png/,
    );
  });

  it("a src under another prefix than the one named", () => {
    expect(errorsAfter(() => {}, "/img")[0]).toMatch(
      /\.src: expected \/img\/onboarding\/pair_host/,
    );
  });

  it("bad sizes and bytes", () => {
    expect(errorsAfter((p) => (variant(p).width = 0)).join("\n")).toMatch(
      /width: expected an integer from 1 to 20000/,
    );
    expect(errorsAfter((p) => (variant(p).height = 1.5)).join("\n")).toMatch(/height/);
    expect(errorsAfter((p) => (variant(p).bytes = 0)).join("\n")).toMatch(
      /bytes: expected a positive integer/,
    );
    expect(
      errorsAfter((p) => delete (variant(p) as Partial<ReturnType<typeof variant>>).bytes).join(
        "\n",
      ),
    ).toMatch(/bytes/);
  });

  it("duplicate callout indexes, a bad index and a bad bbox", () => {
    expect(errorsAfter((p) => (variant(p).callouts[1]!.index = 1)).join("\n")).toMatch(
      /callouts\[1\]\.index: duplicate 1/,
    );
    expect(errorsAfter((p) => (variant(p).callouts[0]!.index = 0)).join("\n")).toMatch(
      /index: expected an integer from 1 to 50/,
    );
    expect(errorsAfter((p) => (variant(p).callouts[0]!.bbox!.x = -1)).join("\n")).toMatch(
      /bbox\.x: expected a number >= 0/,
    );
    expect(errorsAfter((p) => (variant(p).callouts[0]!.bbox!.width = 0)).join("\n")).toMatch(
      /bbox\.width: expected a number > 0/,
    );
    expect(errorsAfter((p) => (variant(p).callouts[0]!.bbox!.y = Number.NaN)).join("\n")).toMatch(
      /bbox\.y/,
    );
  });

  it("generated_for that is empty or not a string", () => {
    expect(errorsAfter((p) => (p.generated_for = "")).join("\n")).toMatch(/generated_for/);
    expect(errorsAfter((p) => (p.generated_for = 5 as never)).join("\n")).toMatch(/generated_for/);
  });
});

describe("assertValidPack", () => {
  it("passes a valid pack and lists every problem of an invalid one", () => {
    expect(() => assertValidPack(validPack())).not.toThrow();
    const pack = validPack();
    variant(pack).width = 0;
    variant(pack).bytes = 0;
    expect(() => assertValidPack(pack)).toThrow(
      /screens pack is invalid:\n {2}- .*width[^]*- .*bytes/,
    );
  });
});

describe("serialisePack", () => {
  it("sorts keys at every depth, ends with a newline and carries no timestamp", () => {
    const text = serialisePack(validPack());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "flows": {')).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    const parsed = JSON.parse(text) as ScreensPack;
    expect(Object.keys(parsed)).toEqual(["flows", "generated_for", "schema"]);
    expect(Object.keys(step(parsed).variants)).toEqual(["en.light.390", "es.dark.1280"]);
    expect(Object.keys(variant(parsed))).toEqual(["bytes", "callouts", "height", "src", "width"]);
  });

  it("is the same text whatever order the keys were inserted in", () => {
    const a = validPack();
    const b = validPack();
    const reversed = Object.fromEntries(Object.entries(step(b).variants).reverse());
    step(b).variants = reversed;
    expect(serialisePack(b)).toBe(serialisePack(a));
  });

  it("keeps callouts in index order", () => {
    const parsed = JSON.parse(serialisePack(validPack())) as ScreensPack;
    expect(variant(parsed).callouts.map((c) => c.index)).toEqual([1, 2]);
  });
});

describe("schema helpers", () => {
  it("parseVariantKey splits a key and refuses anything else", () => {
    expect(parseVariantKey("pt-BR.dark.1280")).toEqual({
      locale: "pt-BR",
      theme: "dark",
      viewport: 1280,
    });
    expect(parseVariantKey("en.light")).toBeNull();
    expect(parseVariantKey("en.light.0390")).toBeNull();
  });

  it("normalisePublicPrefix roots, trims and refuses anything that is not a plain path", () => {
    expect(normalisePublicPrefix("/screens/")).toBe("/screens");
    expect(normalisePublicPrefix("screens")).toBe("/screens");
    expect(normalisePublicPrefix("/a/b")).toBe("/a/b");
    expect(normalisePublicPrefix("")).toBe("");
    expect(normalisePublicPrefix("/")).toBe("");
    expect(() => normalisePublicPrefix("/a/../b")).toThrow(/not a plain URL path/);
    expect(() => normalisePublicPrefix("/a b")).toThrow(/not a plain URL path/);
    expect(() => normalisePublicPrefix("/a?x=1")).toThrow(/not a plain URL path/);
  });

  it("fileOfSrc returns the flow/file tail under any prefix, or null", () => {
    expect(fileOfSrc("/screens/app/board.0123abcd.png")).toBe("app/board.0123abcd.png");
    expect(fileOfSrc("/a/b/c/desktop-1280/board_x.0123abcd.png")).toBe(
      "desktop-1280/board_x.0123abcd.png",
    );
    expect(fileOfSrc("app/board.0123abcd.png")).toBe("app/board.0123abcd.png");
    expect(fileOfSrc("/screens/app/board.png")).toBeNull();
    expect(fileOfSrc("/screens/App/board.0123abcd.png")).toBeNull();
    expect(fileOfSrc("/board.0123abcd.png")).toBeNull();
  });
});
