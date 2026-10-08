import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { readRawCapture } from "../src/pack-source.js";
import { parsePackConfig, readWorkspace } from "../src/pack-workspace.js";
import {
  BOX,
  light,
  packConfig,
  sampleRaw,
  writeRawCapture,
  writeWorkspace,
  type RawFlowSpec,
} from "./helpers/pack-fixtures.js";
import { MAX_PNG_BYTES } from "../src/safe-read.js";
import { solidPng } from "./helpers/png.js";

let root = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-source-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const raw = () => path.join(root, "raw");

describe("readRawCapture", () => {
  it("reads flows, steps and variants in name order, with callouts from the sidecar", async () => {
    await writeRawCapture(raw(), sampleRaw());
    const flows = await readRawCapture(raw());
    expect(flows.map((f) => f.id)).toEqual(["onboarding"]);
    const flow = flows[0]!;
    expect(flow.title).toEqual({ en: "Onboarding", es: "Primeros pasos" });
    expect(flow.steps.map((s) => s.id)).toEqual(["done", "pair"]);
    const pair = flow.steps[1]!;
    expect(pair.alt).toEqual({ en: "Pairing screen", es: "Pantalla de emparejado" });
    expect(pair.caption).toEqual({ en: "Pair a host", es: "Empareja un host" });
    expect(pair.variants.map((v) => v.key)).toEqual(["en.light.390", "es.dark.1280"]);
    expect(pair.variants[0]!.callouts.map((c) => c.index)).toEqual([1, 2]);
    expect(pair.variants[0]!.annotations).toHaveLength(2);
    expect(pair.variants[1]!.annotations).toEqual([]);
    expect("caption" in flow.steps[0]!).toBe(false);
  });

  it("reads locales, themes and viewports beyond en/es, light/dark and 390/1280", async () => {
    await writeRawCapture(raw(), {
      f: {
        steps: {
          s: {
            alt: { "pt-BR": "Tela" },
            variants: { "pt-BR.sepia.768": { png: light() } },
          },
        },
      },
    });
    expect((await readRawCapture(raw()))[0]!.steps[0]!.variants[0]!.key).toBe("pt-BR.sepia.768");
  });

  it("treats a missing sidecar as no annotations and a missing flow.json as no title", async () => {
    await writeRawCapture(raw(), {
      f: {
        steps: {
          s: { alt: { en: "S" }, variants: { "en.light.390": { png: light(), noSidecar: true } } },
        },
      },
    });
    const flow = (await readRawCapture(raw()))[0]!;
    expect("title" in flow).toBe(false);
    expect(flow.steps[0]!.variants[0]!.annotations).toEqual([]);
  });

  it("ignores hidden directories and files that are not PNGs", async () => {
    await writeRawCapture(raw(), sampleRaw());
    await fs.mkdir(path.join(raw(), ".git"));
    await fs.writeFile(path.join(raw(), "README.md"), "notes");
    await fs.writeFile(path.join(raw(), "onboarding", "pair", "notes.txt"), "notes");
    expect((await readRawCapture(raw())).map((f) => f.id)).toEqual(["onboarding"]);
  });

  it("refuses a missing directory, an empty one and an unsafe directory name", async () => {
    await expect(readRawCapture(raw())).rejects.toThrow(/raw capture directory not found/);
    await fs.mkdir(raw(), { recursive: true });
    await expect(readRawCapture(raw())).rejects.toThrow(/no flows found/);
    await fs.mkdir(path.join(raw(), "Bad Flow"));
    await expect(readRawCapture(raw())).rejects.toThrow(/unsupported directory name "Bad Flow"/);
  });

  it("refuses a step without step.json, without a PNG, or with malformed text", async () => {
    await fs.mkdir(path.join(raw(), "f", "s"), { recursive: true });
    await expect(readRawCapture(raw())).rejects.toThrow(/missing .*step\.json/);
    await fs.writeFile(
      path.join(raw(), "f", "s", "step.json"),
      JSON.stringify({ alt: { en: "S" } }),
    );
    await expect(readRawCapture(raw())).rejects.toThrow(
      /step f\/s has no <locale>\.<theme>\.<viewport>\.png/,
    );
    await fs.writeFile(path.join(raw(), "f", "s", "step.json"), JSON.stringify({ alt: "S" }));
    await fs.writeFile(path.join(raw(), "f", "s", "en.light.390.png"), light());
    await expect(readRawCapture(raw())).rejects.toThrow(
      /f\/s alt must be an object of locale to text/,
    );
    await fs.writeFile(path.join(raw(), "f", "s", "step.json"), "{ nope");
    await expect(readRawCapture(raw())).rejects.toThrow(/invalid JSON in .*step\.json/);
    await fs.writeFile(path.join(raw(), "f", "s", "step.json"), "[]");
    await expect(readRawCapture(raw())).rejects.toThrow(/step\.json: expected a JSON object/);
  });

  it("refuses a PNG whose name is not a variant key", async () => {
    for (const name of ["mobile.png", "en.light.png", "EN.light.390.png", "en.light.12.png"]) {
      await fs.rm(raw(), { recursive: true, force: true });
      await writeRawCapture(raw(), {
        f: { steps: { s: { alt: { en: "S" }, variants: { "en.light.390": { png: light() } } } } },
      });
      await fs.copyFile(
        path.join(raw(), "f", "s", "en.light.390.png"),
        path.join(raw(), "f", "s", name),
      );
      await expect(readRawCapture(raw()), name).rejects.toThrow(
        /variant file must be <locale>\.<theme>\.<viewport>\.png/,
      );
    }
  });

  it("refuses a sidecar that disagrees with its PNG", async () => {
    await writeRawCapture(raw(), {
      f: {
        steps: {
          s: {
            alt: { en: "S" },
            variants: { "en.light.390": { png: light(), sidecar: { width: 9, height: 30 } } },
          },
        },
      },
    });
    await expect(readRawCapture(raw())).rejects.toThrow(/sidecar says 9x30, PNG is 40x30/);
  });

  describe("annotations in a sidecar", () => {
    const withAnnotations = (annotations: unknown): Record<string, RawFlowSpec> => ({
      f: {
        steps: {
          s: {
            alt: { en: "S" },
            variants: { "en.light.390": { png: light(), sidecar: { annotations } } },
          },
        },
      },
    });
    const good = { index: 1, copy: "One", bbox: BOX };

    it.each<[string, unknown, RegExp]>([
      ["not an array", { index: 1 }, /annotations must be an array/],
      ["not an object", [5], /annotation 0: annotation must be an object/],
      ["no index", [{ copy: "x", bbox: BOX }], /index must be a positive integer/],
      ["index 0", [{ ...good, index: 0 }], /index must be a positive integer/],
      ["empty copy", [{ ...good, copy: " " }], /copy must be a non-empty string/],
      ["no bbox", [{ index: 1, copy: "x" }], /bbox needs numeric x, y, width and height/],
      ["bbox with a string", [{ ...good, bbox: { ...BOX, x: "1" } }], /bbox needs numeric/],
      ["diagonal arrow", [{ ...good, arrow_style: "diagonal" }], /arrow_style must be/],
      ["nudge without y", [{ ...good, nudge: { x: 1 } }], /nudge needs numeric x and y/],
      ["obstacles not an array", [{ ...good, obstacles: {} }], /obstacles must be an array/],
      [
        "too many obstacles",
        [{ ...good, obstacles: Array.from({ length: 41 }, () => BOX) }],
        /at most 40 boxes/,
      ],
      ["bad obstacle", [{ ...good, obstacles: [{ x: 1 }] }], /obstacle needs numeric/],
      ["placement not an object", [{ ...good, placement: "right" }], /placement must be an object/],
      [
        "placement side",
        [{ ...good, placement: { side: "middle" } }],
        /placement\.side must be one of/,
      ],
      [
        "placement align",
        [{ ...good, placement: { align: "left" } }],
        /placement\.align must be one of/,
      ],
      [
        "placement inside",
        [{ ...good, placement: { inside: "yes" } }],
        /placement\.inside must be a boolean/,
      ],
      [
        "placement pin_arrow",
        [{ ...good, placement: { pin_arrow: 1 } }],
        /placement\.pin_arrow must be a boolean/,
      ],
      [
        "placement max_width",
        [{ ...good, placement: { max_width: 50 } }],
        /placement\.max_width must be 120 to 560/,
      ],
    ])("refuses %s", async (_name, annotations, message) => {
      await writeRawCapture(raw(), withAnnotations(annotations));
      await expect(readRawCapture(raw())).rejects.toThrow(message);
    });

    it("names the sidecar and the annotation in the error", async () => {
      await writeRawCapture(raw(), withAnnotations([good, { ...good, index: 0 }]));
      await expect(readRawCapture(raw())).rejects.toThrow(
        /en\.light\.390\.json: annotation 1: index/,
      );
    });
  });
});

describe("parsePackConfig", () => {
  const config = () => packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]);

  it("reads sources and per-flow text", () => {
    expect(parsePackConfig(config())).toEqual({
      sources: { "desktop-1280": { flow: "app", variant: "en.dark.1280" } },
      flows: { app: { title: { en: "App" }, steps: { board: { alt: { en: "The board page" } } } } },
    });
  });

  it("reads caption, and a flow with no title", () => {
    const c = config() as { flows: { app: Record<string, unknown> } };
    delete c.flows.app.title;
    (c.flows.app.steps as Record<string, Record<string, unknown>>).board!.caption = { en: "Board" };
    const parsed = parsePackConfig(c);
    expect(parsed.flows.app).toEqual({
      steps: { board: { alt: { en: "The board page" }, caption: { en: "Board" } } },
    });
  });

  it("keeps a flow or step named __proto__ as an own entry", () => {
    const c = config() as Record<string, any>;
    c.flows = JSON.parse(
      '{"__proto__":{"steps":{"__proto__":{"alt":{"en":"A"}}}},"app":{"steps":{}}}',
    );
    const parsed = parsePackConfig(c);
    expect(Object.keys(parsed.flows).sort()).toEqual(["__proto__", "app"]);
    expect(
      Object.keys(Object.getOwnPropertyDescriptor(parsed.flows, "__proto__")!.value.steps),
    ).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(parsed.flows)).toBe(Object.prototype);
  });

  it.each<[string, (c: Record<string, any>) => void, RegExp]>([
    [
      "wrong schema",
      (c) => (c.schema = "docsxai/pack-config@2"),
      /schema must be "docsxai\/pack-config@1"/,
    ],
    ["no sources", (c) => (c.sources = {}), /sources is empty/],
    ["sources not an object", (c) => (c.sources = []), /sources must be an object/],
    [
      "source named like a path",
      (c) => (c.sources = { "../x": { flow: "app", variant: "en.dark.390" } }),
      /sources\["\.\.\/x"\] is not a flow name/,
    ],
    [
      "source flow not an id",
      (c) => (c.sources["desktop-1280"].flow = "App"),
      /\.flow must be a flow id/,
    ],
    [
      "source variant not a key",
      (c) => (c.sources["desktop-1280"].variant = "dark"),
      /\.variant must be <locale>\.<theme>\.<viewport>/,
    ],
    [
      "two sources that differ only by case",
      (c) => {
        c.sources = {
          "Desktop-1280": { flow: "app", variant: "en.dark.1280" },
          "desktop-1280": { flow: "app", variant: "en.light.1280" },
        };
      },
      /sources\["Desktop-1280"\] and sources\["desktop-1280"\] differ only by case/,
    ],
    [
      "a source named __proto__",
      (c) => {
        // JSON.parse makes an own `__proto__` key; an object literal would set the prototype.
        c.sources = JSON.parse('{"__proto__":{"flow":"app","variant":"en.dark.390"}}');
      },
      /sources\["__proto__"\] is a reserved name/,
    ],
    [
      "a source named constructor",
      (c) => (c.sources = { constructor: { flow: "app", variant: "en.dark.390" } }),
      /sources\["constructor"\] is a reserved name/,
    ],
    [
      "a source named prototype",
      (c) => (c.sources = { prototype: { flow: "app", variant: "en.dark.390" } }),
      /sources\["prototype"\] is a reserved name/,
    ],
    ["flows missing", (c) => delete c.flows, /flows must be an object/],
    ["steps missing", (c) => delete c.flows.app.steps, /flows\["app"\]\.steps must be an object/],
    [
      "alt not locale text",
      (c) => (c.flows.app.steps.board.alt = "The board"),
      /alt must be an object of locale to text/,
    ],
    [
      "alt value not a string",
      (c) => (c.flows.app.steps.board.alt = { en: 5 }),
      /alt\.en must be a string/,
    ],
  ])("refuses %s", (_name, edit, message) => {
    const c = config() as Record<string, any>;
    edit(c);
    expect(() => parsePackConfig(c)).toThrow(message);
  });
});

describe("readWorkspace", () => {
  const annotation = (index: number, copy: string, step: string): AnnotationRecord => ({
    step,
    selector: `#a${index}`,
    copy,
    bounding_box: { x: 4 * index, y: 4, width: 12, height: 8 },
    index,
  });
  const ws = () => path.join(root, "ws");
  const shots = (...steps: string[]) =>
    Object.fromEntries(steps.map((s, i) => [s, light([200 + i, 200, 200, 255])]));

  it("merges capture flows into the logical flow, one variant each, with the text from pack.json", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "mobile-390": "en.dark.390", "desktop-1280": "en.dark.1280" }, [
        "board",
        "palette",
      ]),
      shots: { "desktop-1280": shots("board", "palette"), "mobile-390": shots("board") },
      annotations: {
        "desktop-1280": [
          annotation(1, "First", "board"),
          annotation(2, "Second", "board"),
          annotation(1, "Search", "palette"),
        ],
      },
    });
    const flows = await readWorkspace(ws());
    expect(flows.map((f) => f.id)).toEqual(["app"]);
    expect(flows[0]!.title).toEqual({ en: "App" });
    expect(flows[0]!.steps.map((s) => s.id)).toEqual(["board", "palette"]);
    const board = flows[0]!.steps[0]!;
    expect(board.alt).toEqual({ en: "The board page" });
    expect(board.variants.map((v) => v.key)).toEqual(["en.dark.1280", "en.dark.390"]);
    expect(board.variants[0]!.callouts).toEqual([
      { index: 1, copy: "First", bbox: { x: 4, y: 4, width: 12, height: 8 } },
      { index: 2, copy: "Second", bbox: { x: 8, y: 4, width: 12, height: 8 } },
    ]);
    expect(board.variants[0]!.annotations).toHaveLength(2);
    expect(board.variants[1]!.annotations).toEqual([]);
    expect(flows[0]!.steps[1]!.variants.map((v) => v.key)).toEqual(["en.dark.1280"]);
  });

  it("lists as callouts only what the burner draws, and numbers un-indexed records by position", async () => {
    const noBox = { ...annotation(2, "Halo only elsewhere", "board"), bounding_box: undefined };
    const noCopy = { ...annotation(3, "", "board") };
    const { index: _a, ...plain1 } = annotation(1, "Plain one", "board");
    const { index: _b, ...plain2 } = annotation(2, "Plain two", "board");
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": shots("board") },
      annotations: { "desktop-1280": [plain1, noBox, noCopy, plain2] },
    });
    const variant = (await readWorkspace(ws()))[0]!.steps[0]!.variants[0]!;
    expect(variant.annotations).toHaveLength(4);
    expect(variant.callouts.map((c) => [c.index, c.copy])).toEqual([
      [1, "Plain one"],
      [2, "Plain two"],
    ]);
  });

  it("works without an annotations.json and ignores records for other steps and non-objects", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": shots("board") },
    });
    expect((await readWorkspace(ws()))[0]!.steps[0]!.variants[0]!.callouts).toEqual([]);

    await fs.writeFile(
      path.join(ws(), "docs", "desktop-1280", "annotations.json"),
      JSON.stringify({ annotations: [annotation(1, "Other", "palette"), 5, null] }),
    );
    expect((await readWorkspace(ws()))[0]!.steps[0]!.variants[0]!.annotations).toEqual([]);
  });

  it("stops on a screenshot with no text in pack.json, and on text with no screenshot", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": shots("board", "extra") },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /pack\.json has no flows\["app"\]\.steps\["extra"\] \(screenshot desktop-1280\/extra\.png\)/,
    );
    await fs.rm(ws(), { recursive: true, force: true });
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board", "ghost"]),
      shots: { "desktop-1280": shots("board") },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /flows\["app"\]\.steps\["ghost"\] has no screenshot/,
    );
  });

  it("stops when two sources feed one variant, a source has no screenshots or a flow has no source", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ a: "en.dark.1280", b: "en.dark.1280" }, ["board"]),
      shots: { a: shots("board"), b: shots("board") },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /two sources feed app\/board\/en\.dark\.1280/,
    );

    await fs.rm(ws(), { recursive: true, force: true });
    await writeWorkspace(ws(), {
      config: packConfig({ a: "en.dark.1280" }, ["board"]),
      shots: {},
    });
    await expect(readWorkspace(ws())).rejects.toThrow(/no screenshots under .*a.screenshots/);

    await fs.rm(ws(), { recursive: true, force: true });
    const config = packConfig({ a: "en.dark.1280" }, ["board"]) as {
      flows: Record<string, unknown>;
    };
    config.flows.other = { steps: { x: { alt: { en: "X" } } } };
    await writeWorkspace(ws(), { config, shots: { a: shots("board") } });
    await expect(readWorkspace(ws())).rejects.toThrow(/flows\["other"\] has no source feeding it/);
  });

  it("names a flow called constructor instead of throwing a TypeError", async () => {
    const config = packConfig({ a: "en.dark.1280" }, ["board"]) as {
      sources: Record<string, { flow: string }>;
    };
    config.sources.a!.flow = "constructor";
    await writeWorkspace(ws(), { config, shots: { a: shots("board") } });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /pack\.json has no flows\["constructor"\]\.steps\["board"\]/,
    );
  });

  it("does not take a screenshot called constructor for a step of the flow", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ a: "en.dark.1280" }, ["board"]),
      shots: { a: shots("board", "constructor") },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /pack\.json has no flows\["app"\]\.steps\["constructor"\]/,
    );
  });

  it("refuses a workspace without pack.json", async () => {
    await fs.mkdir(path.join(ws(), "docs"), { recursive: true });
    await expect(readWorkspace(ws())).rejects.toThrow(/missing .*pack\.json/);
  });

  it("reads a PNG as it is, without decoding it", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": { board: solidPng(7, 5) } },
    });
    const variant = (await readWorkspace(ws()))[0]!.steps[0]!.variants[0]!;
    expect(variant.png.equals(solidPng(7, 5))).toBe(true);
  });
});

describe("inputs the pack commands do not trust", () => {
  const ws = () => path.join(root, "ws");

  it("refuses a symlinked PNG in a raw capture", async () => {
    await writeRawCapture(raw(), sampleRaw());
    const png = path.join(raw(), "onboarding", "done", "en.light.390.png");
    const elsewhere = path.join(root, "elsewhere.png");
    await fs.rename(png, elsewhere);
    await fs.symlink(elsewhere, png);
    await expect(readRawCapture(raw())).rejects.toThrow(/en\.light\.390\.png is a symlink/);
  });

  it("refuses a symlinked sidecar in a raw capture", async () => {
    await writeRawCapture(raw(), sampleRaw());
    const sidecar = path.join(raw(), "onboarding", "pair", "en.light.390.json");
    const elsewhere = path.join(root, "elsewhere.json");
    await fs.rename(sidecar, elsewhere);
    await fs.symlink(elsewhere, sidecar);
    await expect(readRawCapture(raw())).rejects.toThrow(/en\.light\.390\.json is a symlink/);
  });

  it("refuses a PNG over the size cap before reading it", async () => {
    await writeRawCapture(raw(), sampleRaw());
    const png = path.join(raw(), "onboarding", "done", "en.light.390.png");
    await fs.truncate(png, MAX_PNG_BYTES + 1);
    await expect(readRawCapture(raw())).rejects.toThrow(/is larger than 64 MiB/);
  });

  it("does not echo file contents when a sidecar is not JSON", async () => {
    await writeRawCapture(raw(), sampleRaw());
    const sidecar = path.join(raw(), "onboarding", "pair", "en.light.390.json");
    await fs.writeFile(sidecar, '{"token": "sk-live-hunter2" oops');
    const error = await readRawCapture(raw()).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/invalid JSON in .*en\.light\.390\.json$/);
    expect((error as Error).message).not.toContain("hunter2");
  });

  it("names workspace-relative paths in read errors", async () => {
    const config = packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]);
    await writeWorkspace(ws(), { config, shots: {} });
    let error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^no screenshots under docs\/desktop-1280\/screenshots$/);

    await writeWorkspace(ws(), {
      config,
      shots: { "desktop-1280": { board: solidPng(7, 5) } },
    });
    const annotations = path.join(ws(), "docs", "desktop-1280", "annotations.json");
    await fs.writeFile(annotations, "{ nope");
    error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toBe("invalid JSON in docs/desktop-1280/annotations.json");

    await fs.writeFile(annotations, JSON.stringify({ annotations: {} }));
    error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toBe("docs/desktop-1280/annotations.json: annotations must be an array");

    await fs.rm(annotations);
    const shot = path.join(ws(), "docs", "desktop-1280", "screenshots", "board.png");
    await fs.rename(shot, path.join(root, "elsewhere.png"));
    await fs.symlink(path.join(root, "elsewhere.png"), shot);
    error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/^docs\/desktop-1280\/screenshots\/board\.png is a symlink/);
  });

  it("strips control characters from a screenshot name in the error", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ a: "en.dark.1280" }, ["board"]),
      shots: { a: { board: solidPng(7, 5), "x\u001b[31my": solidPng(7, 5) } },
    });
    const error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toBe(
      'pack.json has no flows["app"].steps["x[31my"] (screenshot a/x[31my.png)',
    );
  });

  it("refuses a symlinked screenshots directory in a workspace source", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": { board: solidPng(7, 5) } },
    });
    const dir = path.join(ws(), "docs", "desktop-1280", "screenshots");
    const elsewhere = path.join(root, "elsewhere-shots");
    await fs.rename(dir, elsewhere);
    await fs.symlink(elsewhere, dir, "dir");
    await expect(readWorkspace(ws())).rejects.toThrow(
      /docs\/desktop-1280\/screenshots is a symlink/,
    );
  });

  it("refuses a symlinked capture flow directory in a workspace source", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": { board: solidPng(7, 5) } },
    });
    const dir = path.join(ws(), "docs", "desktop-1280");
    const elsewhere = path.join(root, "elsewhere-flow");
    await fs.rename(dir, elsewhere);
    await fs.symlink(elsewhere, dir, "dir");
    const error = await readWorkspace(ws()).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/docs\/desktop-1280 is a symlink/);
    expect((error as Error).message).not.toContain(root);
  });

  it("refuses a symlinked screenshot in a workspace source", async () => {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": { board: solidPng(7, 5) } },
    });
    const shot = path.join(ws(), "docs", "desktop-1280", "screenshots", "board.png");
    const elsewhere = path.join(root, "elsewhere.png");
    await fs.rename(shot, elsewhere);
    await fs.symlink(elsewhere, shot);
    await expect(readWorkspace(ws())).rejects.toThrow(/board\.png is a symlink/);
  });
});
