import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { buildPack, hash8, viewerBurner, type Burner } from "../src/pack-build.js";
import {
  MISSING_OXIPNG,
  OXIPNG_ARGS,
  createOxipngOptimiser,
  identityOptimiser,
  oxipngCommand,
} from "../src/pack-optimise.js";
import { serialisePack } from "../src/pack-schema.js";
import { readRawCapture, type PackSource } from "../src/pack-source.js";
import {
  BOX,
  light,
  markingBurner,
  sampleRaw,
  writeOxipngShim,
  writeRawCapture,
  type RawFlowSpec,
} from "./helpers/pack-fixtures.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

let root = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-build-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

async function sourceOf(spec: Record<string, RawFlowSpec> = sampleRaw()): Promise<PackSource> {
  const dir = path.join(root, "raw");
  await writeRawCapture(dir, spec);
  return readRawCapture(dir);
}

const sha8 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 8);
const quiet = () => {};

describe("buildPack", () => {
  it("assembles flows, steps and variants with hash-named src, sizes, byte counts and callouts", async () => {
    const { pack, files, manifestText } = await buildPack({
      source: await sourceOf(),
      burn: markingBurner,
      warn: quiet,
    });
    expect(pack.schema).toBe("docsxai/screens-pack@2");
    expect("generated_for" in pack).toBe(false);
    const flow = pack.flows.onboarding!;
    expect(flow.title).toEqual({ en: "Onboarding", es: "Primeros pasos" });
    expect(Object.keys(flow.steps).sort()).toEqual(["done", "pair"]);
    expect(flow.steps.pair!.caption).toEqual({ en: "Pair a host", es: "Empareja un host" });
    expect("caption" in flow.steps.done!).toBe(false);

    const variant = flow.steps.pair!.variants["en.light.390"]!;
    expect(variant.width).toBe(40);
    expect(variant.height).toBe(30);
    expect(variant.callouts).toEqual([
      { index: 1, copy: "Scan the code", bbox: BOX },
      { index: 2, copy: "Confirm", bbox: { x: 20, y: 14, width: 10, height: 8 } },
    ]);
    expect(flow.steps.pair!.variants["es.dark.1280"]!.callouts).toEqual([]);

    expect(files.size).toBe(3);
    for (const [key, v] of Object.entries(flow.steps.pair!.variants)) {
      const relative = v.src.replace(/^\/screens\//, "");
      const bytes = files.get(relative)!;
      expect(bytes, key).toBeDefined();
      expect(v.src).toBe(`/screens/onboarding/pair.${sha8(bytes)}.png`);
      expect(v.bytes).toBe(bytes.length);
    }
    expect(manifestText).toBe(serialisePack(pack));
    expect(manifestText.endsWith("}\n")).toBe(true);
    expect(manifestText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("records generated_for only when given", async () => {
    const { pack } = await buildPack({
      source: await sourceOf(),
      burn: markingBurner,
      generatedFor: "abc123",
      warn: quiet,
    });
    expect(pack.generated_for).toBe("abc123");
  });

  it("gives the burner only the variants that have annotations, with the records it needs", async () => {
    const calls: Array<{ step: string; records: AnnotationRecord[] }> = [];
    const burn: Burner = (png, records, warn) => {
      calls.push({ step: records[0]!.step, records });
      return markingBurner(png, records, warn);
    };
    const { pack, files } = await buildPack({ source: await sourceOf(), burn, warn: quiet });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.step).toBe("pair");
    expect(calls[0]!.records).toEqual([
      {
        step: "pair",
        selector: "annotation-1",
        copy: "Scan the code",
        bounding_box: BOX,
        index: 1,
      },
      {
        step: "pair",
        selector: "annotation-2",
        copy: "Confirm",
        bounding_box: { x: 20, y: 14, width: 10, height: 8 },
        index: 2,
      },
    ]);
    // Burned variant carries the marker; the others are the capture, byte for byte.
    const burned = files.get(
      pack.flows.onboarding!.steps.pair!.variants["en.light.390"]!.src.slice("/screens/".length),
    )!;
    expect(pixelAt(decodePng(burned), 0, 0)).toEqual([255, 0, 0, 255]);
    const dark = files.get(
      pack.flows.onboarding!.steps.pair!.variants["es.dark.1280"]!.src.slice("/screens/".length),
    )!;
    expect(dark.equals(light([20, 20, 20, 255]))).toBe(true);
  });

  it("passes obstacles, placement, nudge and arrow_style to the burner and numbers badges only for 2+ annotations", async () => {
    const png = light();
    const spec: Record<string, RawFlowSpec> = {
      f: {
        steps: {
          s: {
            alt: { en: "S" },
            variants: {
              "en.light.390": {
                png,
                sidecar: {
                  annotations: [
                    {
                      index: 1,
                      copy: "One",
                      bbox: BOX,
                      arrow_style: "bottom-left",
                      nudge: { x: -4, y: 2 },
                      obstacles: [{ x: 20, y: 4, width: 10, height: 6 }],
                      placement: { side: "right", align: "start", pin_arrow: true, max_width: 200 },
                    },
                  ],
                },
              },
              "en.dark.390": {
                png,
                sidecar: { annotations: [{ index: 1, copy: "Solo", bbox: BOX }] },
              },
            },
          },
        },
      },
    };
    const seen = new Map<string, AnnotationRecord[]>();
    const burn: Burner = (p, records, warn) => {
      seen.set(records[0]!.copy, records);
      return markingBurner(p, records, warn);
    };
    await buildPack({ source: await sourceOf(spec), burn, warn: quiet });
    expect(seen.get("One")).toEqual([
      {
        step: "s",
        selector: "annotation-1",
        copy: "One",
        bounding_box: BOX,
        arrow_style: "bottom-left",
        nudge: { x: -4, y: 2 },
        obstacles: [{ x: 20, y: 4, width: 10, height: 6 }],
        placement: { side: "right", align: "start", pin_arrow: true, max_width: 200 },
      },
    ]);
    expect(seen.get("Solo")![0]!.index).toBeUndefined();
  });

  it("is deterministic: the same capture builds the same files and the same manifest text", async () => {
    const source = await sourceOf();
    const a = await buildPack({ source, burn: markingBurner, warn: quiet });
    const b = await buildPack({ source, burn: markingBurner, warn: quiet });
    expect(b.manifestText).toBe(a.manifestText);
    expect([...b.files.keys()]).toEqual([...a.files.keys()]);
    for (const [key, bytes] of a.files) expect(b.files.get(key)!.equals(bytes)).toBe(true);
  });

  it("honours a public prefix and refuses one that is not a plain path", async () => {
    const source = await sourceOf();
    const { pack } = await buildPack({
      source,
      burn: markingBurner,
      publicPrefix: "img/docs/",
      warn: quiet,
    });
    expect(pack.flows.onboarding!.steps.done!.variants["en.light.390"]!.src).toMatch(
      /^\/img\/docs\/onboarding\/done\.[0-9a-f]{8}\.png$/,
    );
    await expect(
      buildPack({ source, burn: markingBurner, publicPrefix: "/a/../b", warn: quiet }),
    ).rejects.toThrow(/not a plain URL path/);
  });

  it("stops on a loopback address or a secret in any text, before anything is written", async () => {
    const spec = sampleRaw();
    spec.onboarding!.steps.pair!.alt.en = "Open http://localhost:3000";
    await expect(
      buildPack({ source: await sourceOf(spec), burn: markingBurner, warn: quiet }),
    ).rejects.toThrow(
      /pack guard stopped the build:\n {2}- flows\["onboarding"\]\.steps\["pair"\]\.alt\.en: loopback host/,
    );

    const leaky = sampleRaw();
    leaky.onboarding!.steps.pair!.variants["en.light.390"]!.sidecar = {
      annotations: [{ index: 1, copy: "Token sk-abcdefghijklmnopqrstuvwx", bbox: BOX }],
    };
    await fs.rm(path.join(root, "raw"), { recursive: true, force: true });
    await expect(
      buildPack({ source: await sourceOf(leaky), burn: markingBurner, warn: quiet }),
    ).rejects.toThrow(/callouts\[1\]\.copy: API key \(sk-\)/);
  });

  it("rejects text that does not cover a variant's locale and an empty source", async () => {
    const spec = sampleRaw();
    spec.onboarding!.steps.pair!.alt = { en: "Pairing screen" };
    await expect(
      buildPack({ source: await sourceOf(spec), burn: markingBurner, warn: quiet }),
    ).rejects.toThrow(/no text for locale "es" used by variant "es\.dark\.1280"/);
    await expect(buildPack({ source: [], burn: markingBurner, warn: quiet })).rejects.toThrow(
      /pack\.flows: expected 1 to 200 flows/,
    );
  });

  it("prefixes burner warnings with the variant and sums unplaceable callouts", async () => {
    const warnings: string[] = [];
    const burn: Burner = (png, _records, warn) => {
      warn("no clear spot");
      return Promise.resolve({ png, unplaceable: 2 });
    };
    const built = await buildPack({
      source: await sourceOf(),
      burn,
      warn: (m) => warnings.push(m),
    });
    expect(warnings).toEqual(["onboarding/pair/en.light.390: no clear spot"]);
    expect(built.unplaceable).toBe(2);
  });

  it("refuses an optimiser that changes the image size", async () => {
    await expect(
      buildPack({
        source: await sourceOf(),
        burn: markingBurner,
        optimise: () => Promise.resolve(solidPng(10, 10)),
        warn: quiet,
      }),
    ).rejects.toThrow(/onboarding\/done\/en\.light\.390: output is 10x10, capture is 40x30/);
  });
});

describe("hashing the final bytes", () => {
  it("names each file after the optimiser's output, and records that file's size", async () => {
    const shim = await writeOxipngShim(root);
    const optimise = await createOxipngOptimiser(shim.command);
    const source = await sourceOf();
    const plain = await buildPack({
      source,
      burn: markingBurner,
      optimise: identityOptimiser,
      warn: quiet,
    });
    const packed = await buildPack({ source, burn: markingBurner, optimise, warn: quiet });

    expect(packed.files.size).toBe(plain.files.size);
    const plainStep = plain.pack.flows.onboarding!.steps.pair!.variants["en.light.390"]!;
    const packedStep = packed.pack.flows.onboarding!.steps.pair!.variants["en.light.390"]!;
    const plainBytes = plain.files.get(plainStep.src.slice("/screens/".length))!;
    const finalBytes = packed.files.get(packedStep.src.slice("/screens/".length))!;

    expect(finalBytes.equals(plainBytes)).toBe(false);
    expect(finalBytes.length).toBeGreaterThan(plainBytes.length);
    expect(packedStep.src).toBe(`/screens/onboarding/pair.${sha8(finalBytes)}.png`);
    expect(packedStep.src).not.toBe(plainStep.src);
    expect(packedStep.bytes).toBe(finalBytes.length);
    expect(hash8(finalBytes)).toBe(sha8(finalBytes));
    // Lossless: same pixels.
    expect(Array.from(decodePng(finalBytes).rgba)).toEqual(Array.from(decodePng(plainBytes).rgba));
  });

  it("runs oxipng once per variant with the lossless arguments", async () => {
    const shim = await writeOxipngShim(root);
    const optimise = await createOxipngOptimiser(shim.command);
    await buildPack({ source: await sourceOf(), burn: markingBurner, optimise, warn: quiet });
    const calls = await shim.calls();
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args.slice(0, OXIPNG_ARGS.length)).toEqual(OXIPNG_ARGS);
      expect(args[OXIPNG_ARGS.length]).toBe("--out");
      expect(args).toHaveLength(OXIPNG_ARGS.length + 3);
    }
    expect(OXIPNG_ARGS).toEqual(["-o", "4", "--strip", "safe"]);
  });

  it("builds the same manifest text twice with the same optimiser", async () => {
    const shim = await writeOxipngShim(root);
    const optimise = await createOxipngOptimiser(shim.command);
    const source = await sourceOf();
    const a = await buildPack({ source, burn: markingBurner, optimise, warn: quiet });
    const b = await buildPack({ source, burn: markingBurner, optimise, warn: quiet });
    expect(b.manifestText).toBe(a.manifestText);
  });
});

describe("createOxipngOptimiser", () => {
  it("fails with the install hint when oxipng is not on PATH", async () => {
    vi.stubEnv("PATH", "");
    await expect(createOxipngOptimiser()).rejects.toThrow(MISSING_OXIPNG);
    expect(MISSING_OXIPNG).toBe("oxipng not found on PATH. Install it with: brew install oxipng");
  });

  it("names the variable when the configured binary does not exist", async () => {
    await expect(createOxipngOptimiser(path.join(root, "nope"))).rejects.toThrow(
      /oxipng not found at .*nope \(DOCSX_OXIPNG_BIN\)/,
    );
  });

  it("fails when the binary cannot report a version", async () => {
    const script = path.join(root, "broken-oxipng");
    await fs.writeFile(script, "#!/bin/sh\necho boom >&2\nexit 3\n");
    await fs.chmod(script, 0o755);
    await expect(createOxipngOptimiser(script)).rejects.toThrow(/--version failed: boom/);
  });

  it("returns the input when oxipng writes no output file", async () => {
    const script = path.join(root, "silent-oxipng");
    await fs.writeFile(script, "#!/bin/sh\nexit 0\n");
    await fs.chmod(script, 0o755);
    const optimise = await createOxipngOptimiser(script);
    const png = solidPng(4, 4);
    expect((await optimise(png)).equals(png)).toBe(true);
  });

  it("takes the command from DOCSX_OXIPNG_BIN, else oxipng", () => {
    expect(oxipngCommand({})).toBe("oxipng");
    expect(oxipngCommand({ DOCSX_OXIPNG_BIN: "/opt/bin/oxipng" })).toBe("/opt/bin/oxipng");
    expect(oxipngCommand({ DOCSX_OXIPNG_BIN: "" })).toBe("oxipng");
  });
});

describe("the viewer's own burner", () => {
  it("draws callouts onto a real screenshot, keeps its size and burns the same bytes twice", async () => {
    const png = solidPng(240, 140, [240, 240, 240, 255]);
    const spec: Record<string, RawFlowSpec> = {
      f: {
        steps: {
          s: {
            alt: { en: "S" },
            variants: {
              "en.light.390": {
                png,
                sidecar: {
                  annotations: [
                    {
                      index: 1,
                      copy: "Scan the code",
                      bbox: { x: 20, y: 20, width: 60, height: 30 },
                    },
                  ],
                },
              },
              "en.dark.390": { png },
            },
          },
        },
      },
    };
    const source = await sourceOf(spec);
    const a = await buildPack({ source, burn: viewerBurner, warn: quiet });
    const b = await buildPack({ source, burn: viewerBurner, warn: quiet });
    expect(b.manifestText).toBe(a.manifestText);

    const step = a.pack.flows.f!.steps.s!;
    const burned = a.files.get(step.variants["en.light.390"]!.src.slice("/screens/".length))!;
    const clean = a.files.get(step.variants["en.dark.390"]!.src.slice("/screens/".length))!;
    expect(clean.equals(png)).toBe(true);
    expect(burned.equals(png)).toBe(false);
    expect(step.variants["en.light.390"]!).toMatchObject({ width: 240, height: 140 });
    const pixels = decodePng(burned);
    expect([pixels.width, pixels.height]).toEqual([240, 140]);
  });
});
