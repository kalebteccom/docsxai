// Workspace theme loading edges: tokens files that cannot be used, `from` values, config files
// that are not objects, and theme fonts that are short, in another format, truncated or missing.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pngDimensions, renderBurn } from "../src/burn.js";
import { DEFAULT_BURN_THEME } from "../src/burn-theme.js";
import { loadBurnTheme, loadThemeFont } from "../src/burn-theme-load.js";
import { solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));

let ws: string;
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "burn-theme-edges-"));
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

const writeRaw = (rel: string, data: string | Buffer) =>
  fs
    .mkdir(path.dirname(path.join(ws, rel)), { recursive: true })
    .then(() => fs.writeFile(path.join(ws, rel), data));
const writeConfig = (config: unknown) => writeRaw(".docsxai.json", JSON.stringify(config));
const messageOf = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: Error) => e.message,
  );
const fontMessage = async (data: string | Buffer): Promise<string> => {
  await writeRaw("fonts/brand.ttf", data);
  await writeConfig({ burn: { theme: { font: "fonts/brand.ttf" } } });
  return messageOf(loadBurnTheme(ws));
};

describe("a tokens file that cannot be used", () => {
  const fromTokens = () => writeConfig({ burn: { theme: { from: "tokens.json" } } });

  it.each([["[]"], ['"#fff"'], ["5"]])("says so for a document of %s", async (text) => {
    await writeRaw("tokens.json", text);
    await fromTokens();
    expect(await messageOf(loadBurnTheme(ws))).toBe(
      ".docsxai.json burn.theme: from: tokens.json is not usable: must be a JSON object of tokens",
    );
  });

  it("says so for an empty file", async () => {
    await writeRaw("tokens.json", "");
    await fromTokens();
    expect(await messageOf(loadBurnTheme(ws))).toContain("from: tokens.json is not usable");
  });

  it("reports a directory in its place as unreadable", async () => {
    await fs.mkdir(path.join(ws, "tokens.json"));
    await fromTokens();
    expect(await messageOf(loadBurnTheme(ws))).toContain(
      "from: tokens.json does not exist or cannot be read",
    );
  });

  it("reports nesting past 16 levels", async () => {
    let doc: unknown = "#ffffff";
    for (let i = 0; i < 17; i++) doc = { a: doc };
    await writeRaw("tokens.json", JSON.stringify(doc));
    await fromTokens();
    expect(await messageOf(loadBurnTheme(ws))).toContain("tokens nest deeper than 16 levels");
  });

  it("names the token and the file for a value of the wrong type", async () => {
    await writeRaw("tokens.json", JSON.stringify({ color: { accent: 7 } }));
    await fromTokens();
    expect(await messageOf(loadBurnTheme(ws))).toContain(
      'accent: token "color.accent" in tokens.json: 7 is not a colour',
    );
  });

  it.each([
    ["/etc/tokens.json", '"/etc/tokens.json" must be a path inside the workspace'],
    ["tokens.txt", '"tokens.txt" is not a .json file'],
    ["", "must be the path of a tokens file"],
    [5, "must be the path of a tokens file"],
    ["a/../../x.json", '"a/../../x.json" is outside the workspace'],
  ])("refuses from: %j", async (from, message) => {
    await writeConfig({ burn: { theme: { from } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain(`from: ${message}`);
  });
});

describe("a config file that is not shaped like one", () => {
  it.each([["null"], ["[]"], ['"text"'], ["5"]])("has no theme when it is %s", async (text) => {
    await writeRaw(".docsxai.json", text);
    expect(await loadBurnTheme(ws)).toBeUndefined();
  });

  it.each([[null], [[]], ["soft"]])("refuses burn: %j", async (burn) => {
    await writeConfig({ burn });
    expect(await messageOf(loadBurnTheme(ws))).toBe(
      ".docsxai.json burn: must be an object holding theme",
    );
  });

  it("refuses a theme of null", async () => {
    await writeConfig({ burn: { theme: null } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("must be an object, for example");
  });

  it("takes an empty theme block as today's look, with no warning", async () => {
    await writeConfig({ burn: { theme: {} } });
    const loaded = await loadBurnTheme(ws);
    expect(loaded?.theme).toEqual(DEFAULT_BURN_THEME);
    expect(loaded?.warnings).toEqual([]);
  });
});

describe("a theme font that cannot be used", () => {
  it("is undefined for a theme without a font file", async () => {
    expect(await loadThemeFont(DEFAULT_BURN_THEME)).toBeUndefined();
  });

  it("is refused when it is shorter than an sfnt header", async () => {
    expect(await fontMessage(Buffer.from([0, 1, 0, 0]))).toContain(
      "is not a TrueType or OpenType font",
    );
  });

  it("is refused as a WOFF file and as a collection", async () => {
    const woff = Buffer.concat([Buffer.from("wOFF"), Buffer.alloc(20)]);
    const collection = Buffer.concat([Buffer.from("ttcf"), Buffer.alloc(20)]);
    expect(await fontMessage(woff)).toContain("is not a TrueType or OpenType font");
    expect(await fontMessage(collection)).toContain("is not a TrueType or OpenType font");
  });

  it("is refused when the header is right and there are no tables", async () => {
    const header = Buffer.alloc(12);
    header.writeUInt32BE(0x00010000, 0);
    expect(await fontMessage(header)).toContain(
      "cannot be measured: font is missing the head table",
    );
    header.write("OTTO", 0, "latin1");
    expect(await fontMessage(header)).toContain("cannot be measured");
  });

  it("is refused when a real font is cut off", async () => {
    expect(await fontMessage(FONT.subarray(0, 100))).toContain("cannot be measured");
  });

  it("is refused when the path is a directory", async () => {
    await fs.mkdir(path.join(ws, "fonts", "brand.ttf"), { recursive: true });
    await writeConfig({ burn: { theme: { font: "fonts/brand.ttf" } } });
    expect(await messageOf(loadBurnTheme(ws))).toContain("is not a regular file");
  });

  it("stops a burn before any drawing when the file is gone", async () => {
    const theme = { ...DEFAULT_BURN_THEME, fontFile: path.join(ws, "gone.ttf") };
    await expect(
      renderBurn({ screenshotBuffer: solidPng(40, 30), annotations: [], options: { theme } }),
    ).rejects.toThrow(/burn\.theme font .*gone\.ttf does not exist/);
  });
});

describe("a burn with a theme font", () => {
  it("returns a PNG of the screenshot's size for an empty annotation list", async () => {
    await writeRaw("fonts/brand.ttf", FONT);
    await writeConfig({ burn: { theme: { font: "fonts/brand.ttf", font_weight: 600 } } });
    const theme = (await loadBurnTheme(ws))!.theme;
    const { png, report } = await renderBurn({
      screenshotBuffer: solidPng(40, 30),
      annotations: [],
      options: { theme },
    });
    expect(pngDimensions(png)).toEqual({ width: 40, height: 30 });
    expect(report).toEqual([]);
  });
});
