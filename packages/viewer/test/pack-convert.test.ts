import { describe, expect, it } from "vitest";
import { convertScreensManifestV1, convertScreensPackV1 } from "../src/pack-convert.js";
import { serialisePack } from "../src/pack-schema.js";
import { validatePack } from "../src/pack-validate.js";

/** The shape `workspaces/trackxai-docs` shipped: one capture flow per viewport, pages under `screens`. */
function packV1() {
  return {
    schema: "docsxai/screens-pack@1",
    screens: {
      board: {
        alt: "Board with each task as a card",
        variants: {
          "en.dark.1280": {
            src: "/screens/desktop-1280/board.0123abcd.png",
            width: 1280,
            height: 800,
            bytes: 5000,
            callouts: ["First", "Second"],
          },
          "en.dark.390": {
            src: "/screens/mobile-390/board.89abcdef.png",
            width: 390,
            height: 844,
            bytes: 3000,
            callouts: [] as string[],
          },
        },
      },
      palette: {
        alt: "Command palette",
        variants: {
          "en.dark.1280": {
            src: "/screens/desktop-1280/palette.00ff00ff.png",
            width: 1280,
            height: 800,
            bytes: 4000,
            callouts: ["Search"],
          },
        },
      },
    },
  };
}

describe("convertScreensPackV1", () => {
  it("puts every page under the logical flow, with callouts numbered and alt keyed by locale", () => {
    const { pack } = convertScreensPackV1(packV1(), { flow: "app" });
    expect(Object.keys(pack.flows)).toEqual(["app"]);
    const board = pack.flows.app!.steps.board!;
    expect(board.alt).toEqual({ en: "Board with each task as a card" });
    expect(board.variants["en.dark.1280"]).toEqual({
      src: "/screens/app/board.0123abcd.png",
      width: 1280,
      height: 800,
      bytes: 5000,
      callouts: [
        { index: 1, copy: "First" },
        { index: 2, copy: "Second" },
      ],
    });
    expect(board.variants["en.dark.390"]!.src).toBe("/screens/app/board.89abcdef.png");
    expect(pack.flows.app!.steps.palette!.variants["en.dark.1280"]!.callouts).toEqual([
      { index: 1, copy: "Search" },
    ]);
    expect(pack.schema).toBe("docsxai/screens-pack@2");
    expect("generated_for" in pack).toBe(false);
  });

  it("lists the file moves, sorted, and none for a file already in place", () => {
    const { moves } = convertScreensPackV1(packV1(), { flow: "app" });
    expect(moves).toEqual([
      { from: "desktop-1280/board.0123abcd.png", to: "app/board.0123abcd.png" },
      { from: "mobile-390/board.89abcdef.png", to: "app/board.89abcdef.png" },
      { from: "desktop-1280/palette.00ff00ff.png", to: "app/palette.00ff00ff.png" },
    ]);
    const inPlace = packV1();
    inPlace.screens.palette.variants["en.dark.1280"].src = "/screens/app/palette.00ff00ff.png";
    expect(convertScreensPackV1(inPlace, { flow: "app" }).moves).toHaveLength(2);
  });

  it("honours a public prefix", () => {
    const { pack } = convertScreensPackV1(packV1(), { flow: "app", publicPrefix: "/img/" });
    expect(pack.flows.app!.steps.board!.variants["en.dark.390"]!.src).toBe(
      "/img/app/board.89abcdef.png",
    );
  });

  it("gives alt text to every locale a page's variants use", () => {
    const v1 = packV1();
    v1.screens.board.variants["es.dark.1280" as keyof typeof v1.screens.board.variants] = {
      ...v1.screens.board.variants["en.dark.1280"],
      src: "/screens/desktop-1280/board.aaaaaaaa.png",
    };
    const { pack } = convertScreensPackV1(v1, { flow: "app" });
    expect(pack.flows.app!.steps.board!.alt).toEqual({
      en: "Board with each task as a card",
      es: "Board with each task as a card",
    });
  });

  it("produces a pack the validator accepts and canonical text that does not change", () => {
    const { pack } = convertScreensPackV1(packV1(), { flow: "app" });
    expect(validatePack(pack).ok).toBe(true);
    expect(serialisePack(convertScreensPackV1(packV1(), { flow: "app" }).pack)).toBe(
      serialisePack(pack),
    );
  });

  it("refuses another schema, a variant key that is not one, a src with no hash and a bad flow id", () => {
    expect(() =>
      convertScreensPackV1({ ...packV1(), schema: "docsxai/screens-pack@2" }, { flow: "app" }),
    ).toThrow(/pack\.schema: expected "docsxai\/screens-pack@1"/);
    const badKey = packV1();
    Object.assign(badKey.screens.palette.variants, {
      desktop: badKey.screens.palette.variants["en.dark.1280"],
    });
    expect(() => convertScreensPackV1(badKey, { flow: "app" })).toThrow(
      /variants\["desktop"\]: not a <locale>\.<theme>\.<viewport> variant with a hash-named src/,
    );
    const noHash = packV1();
    noHash.screens.board.variants["en.dark.390"].src = "/screens/mobile-390/board.png";
    expect(() => convertScreensPackV1(noHash, { flow: "app" })).toThrow(/hash-named src/);
    expect(() => convertScreensPackV1(packV1(), { flow: "App" })).toThrow(
      /screens pack is invalid/,
    );
    expect(() => convertScreensPackV1(null, { flow: "app" })).toThrow(/pack: expected an object/);
  });
});

/** The shape remotxai's website pipeline wrote: flows, steps, `{en, es}` text, annotations with a bbox. */
function manifestV1() {
  return {
    schema: "docsxai/screens-manifest@1",
    generated_for: "abc123",
    flows: {
      onboarding: {
        title: { en: "Onboarding", es: "Primeros pasos" },
        steps: {
          pair: {
            caption: { en: "Pair a host", es: "Empareja un host" },
            alt: { en: "Pairing screen", es: "Pantalla de emparejado" },
            variants: {
              "en.light.390": {
                src: "/screens/onboarding/pair.0123abcd.png",
                width: 390,
                height: 844,
                annotations: [
                  { index: 1, copy: "Scan", bbox: { x: 1, y: 2, width: 3, height: 4 } },
                  { index: 2, copy: "Confirm", bbox: { x: 5, y: 6, width: 7, height: 8 } },
                ],
              },
              "es.dark.1280": {
                src: "/screens/onboarding/pair.89abcdef.png",
                width: 1280,
                height: 800,
                annotations: [],
              },
            },
          },
        },
      },
    },
  };
}

describe("convertScreensManifestV1", () => {
  const bytesOf = (src: string) => src.length * 100;

  it("renames annotations to callouts, adds byte sizes and keeps text, sizes and src", () => {
    const pack = convertScreensManifestV1(manifestV1(), { bytesOf });
    expect(pack.schema).toBe("docsxai/screens-pack@2");
    expect(pack.generated_for).toBe("abc123");
    const flow = pack.flows.onboarding!;
    expect(flow.title).toEqual({ en: "Onboarding", es: "Primeros pasos" });
    const step = flow.steps.pair!;
    expect(step.caption).toEqual({ en: "Pair a host", es: "Empareja un host" });
    expect(step.alt).toEqual({ en: "Pairing screen", es: "Pantalla de emparejado" });
    expect(step.variants["en.light.390"]).toEqual({
      src: "/screens/onboarding/pair.0123abcd.png",
      width: 390,
      height: 844,
      bytes: bytesOf("/screens/onboarding/pair.0123abcd.png"),
      callouts: [
        { index: 1, copy: "Scan", bbox: { x: 1, y: 2, width: 3, height: 4 } },
        { index: 2, copy: "Confirm", bbox: { x: 5, y: 6, width: 7, height: 8 } },
      ],
    });
    expect(step.variants["es.dark.1280"]!.callouts).toEqual([]);
    expect(JSON.stringify(pack)).not.toContain("annotations");
  });

  it("asks for the size of each file by its src", () => {
    const asked: string[] = [];
    convertScreensManifestV1(manifestV1(), {
      bytesOf: (src) => {
        asked.push(src);
        return 10;
      },
    });
    expect(asked.sort()).toEqual([
      "/screens/onboarding/pair.0123abcd.png",
      "/screens/onboarding/pair.89abcdef.png",
    ]);
  });

  it("leaves out generated_for, caption and title when the manifest has none", () => {
    const m = manifestV1() as Record<string, unknown>;
    delete m.generated_for;
    const flow = (m.flows as ReturnType<typeof manifestV1>["flows"]).onboarding;
    delete (flow as Partial<typeof flow>).title;
    delete (flow.steps.pair as Partial<typeof flow.steps.pair>).caption;
    const pack = convertScreensManifestV1(m, { bytesOf });
    expect("generated_for" in pack).toBe(false);
    expect("title" in pack.flows.onboarding!).toBe(false);
    expect("caption" in pack.flows.onboarding!.steps.pair!).toBe(false);
  });

  it("produces canonical text the validator accepts", () => {
    const pack = convertScreensManifestV1(manifestV1(), { bytesOf });
    expect(validatePack(JSON.parse(serialisePack(pack))).ok).toBe(true);
  });

  it("refuses another schema, an annotation with no bbox and a locale alt does not cover", () => {
    expect(() =>
      convertScreensManifestV1({ ...manifestV1(), schema: "docsxai/screens-pack@1" }, { bytesOf }),
    ).toThrow(/manifest\.schema: expected "docsxai\/screens-manifest@1"/);

    const noBbox = manifestV1();
    delete (
      noBbox.flows.onboarding.steps.pair.variants["en.light.390"].annotations[0] as Record<
        string,
        unknown
      >
    ).bbox;
    expect(() => convertScreensManifestV1(noBbox, { bytesOf })).toThrow(
      /variants\["en\.light\.390"\]\.annotations\[0\]\.bbox: expected an object/,
    );

    const uncovered = manifestV1();
    uncovered.flows.onboarding.steps.pair.alt = { en: "Pairing screen" } as never;
    expect(() => convertScreensManifestV1(uncovered, { bytesOf })).toThrow(
      /no text for locale "es"/,
    );
  });
});
