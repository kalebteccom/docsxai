// `pack.json` over a matrix flow. The fixture under fixtures/engine-matrix/ is laid out the way
// `docsxai run` writes a flow with a `matrix:` block: docs/login/<variant id>/screenshots/<step>.png
// and docs/login/<variant id>/annotations.json (with the `variant` record), where the id is
// <locale>.<color scheme>.<viewport name>. Each test copies it to a temporary workspace.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDrift, runPack } from "../src/pack-cli.js";
import { MAX_VARIANT_DIRS } from "../src/pack-matrix.js";
import type { ScreensPack } from "../src/pack-schema.js";
import { parsePackConfig, readWorkspace } from "../src/pack-workspace.js";
import { validatePack } from "../src/pack-validate.js";

const FIXTURE = new URL("./fixtures/engine-matrix/", import.meta.url).pathname;
const DESKTOP = "en-US.light.desktop-1280";
const MOBILE = "es-ES.dark.mobile-390";
const SCHEMA = "docsxai/pack-config@1";

let root = "";
let out = "";
let err = "";
const ws = () => path.join(root, "ws");

beforeEach(async () => {
  out = "";
  err = "";
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-matrix-"));
  await fs.cp(FIXTURE, ws(), { recursive: true });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

type Obj = Record<string, any>;
const fixtureConfig = async (): Promise<Obj> =>
  JSON.parse(await fs.readFile(path.join(FIXTURE, "pack.json"), "utf8")) as Obj;

/** The fixture's pack.json with its sources replaced: `matrixFlow` and `sources` as given. */
async function setSources(dir: string, parts: { matrixFlow?: Obj; sources?: Obj }): Promise<void> {
  const { matrixFlow: _drop, ...config } = await fixtureConfig();
  await fs.writeFile(path.join(dir, "pack.json"), JSON.stringify({ ...config, ...parts }));
}

const mapOf = (map: Record<string, string>) => ({ matrixFlow: { flow: "login", map } });
const BOTH = { [DESKTOP]: "en.light.1280", [MOBILE]: "es.dark.390" };

const readPack = async (dir: string) =>
  JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as ScreensPack;
const manifestText = (dir: string) => fs.readFile(path.join(dir, "manifest.json"), "utf8");

describe("a matrix flow packed through pack.json", () => {
  it("builds a valid pack from docs/<flow>/<variant id>/, with the callouts of each variant", async () => {
    expect(await runPack([ws(), "--no-optimise"])).toBe(0);
    expect(out).toMatch(/^pack: 4 image\(s\), 5 written, 0 removed in /);
    const pack = await readPack(path.join(ws(), ".screens"));
    expect(validatePack(pack, { publicPrefix: "/screens" })).toEqual({ ok: true, errors: [] });
    expect(Object.keys(pack.flows)).toEqual(["login"]);
    const home = pack.flows.login!.steps.home!;
    expect(Object.keys(home.variants).sort()).toEqual(["en.light.1280", "es.dark.390"]);
    expect(home.variants["en.light.1280"]!.callouts).toEqual([
      { index: 1, copy: "Sign in", bbox: { x: 20, y: 30, width: 40, height: 16 } },
    ]);
    expect(home.variants["es.dark.390"]!.callouts[0]!.copy).toBe("Entrar");
    expect(home.variants["en.light.1280"]).toMatchObject({ width: 160, height: 100 });
    expect(home.variants["es.dark.390"]).toMatchObject({ width: 80, height: 140 });
    expect(Object.keys(pack.flows.login!.steps.done!.variants).sort()).toEqual([
      "en.light.1280",
      "es.dark.390",
    ]);
  });

  it("writes nothing the second time, and pack --check finds no drift", async () => {
    const dest = path.join(root, "committed");
    expect(await runPack([ws(), "--no-optimise", "--out", dest])).toBe(0);
    out = "";
    expect(await runPack([ws(), "--no-optimise", "--out", dest])).toBe(0);
    expect(out).toMatch(/^pack: 4 image\(s\), 0 written, 0 removed in /);
    out = "";
    expect(await runDrift([ws(), "--against", dest])).toBe(0);
    expect(out).toBe("docsxai drift: 4 compared, 0 over threshold (0.5%)\n");
  });

  it("pack --check reads the matrix directories: a changed screenshot drifts", async () => {
    const dest = path.join(root, "committed");
    expect(await runPack([ws(), "--no-optimise", "--out", dest])).toBe(0);
    const shot = path.join(ws(), "docs", "login", MOBILE, "screenshots", "done.png");
    await fs.copyFile(path.join(ws(), "docs", "login", DESKTOP, "screenshots", "done.png"), shot);
    out = "";
    expect(await runDrift([ws(), "--against", dest])).toBe(1);
    expect(out).toContain("es.dark.390");
  });

  it("produces the manifest a flat workspace with the same images produces", async () => {
    const flat = path.join(root, "flat");
    await fs.mkdir(path.join(flat, "docs"), { recursive: true });
    await fs.cp(path.join(ws(), "docs", "login", DESKTOP), path.join(flat, "docs", "desktop"), {
      recursive: true,
    });
    await fs.cp(path.join(ws(), "docs", "login", MOBILE), path.join(flat, "docs", "mobile"), {
      recursive: true,
    });
    await setSources(flat, {
      sources: {
        desktop: { flow: "login", variant: "en.light.1280" },
        mobile: { flow: "login", variant: "es.dark.390" },
      },
    });
    expect(await runPack([flat, "--no-optimise"])).toBe(0);
    expect(await runPack([ws(), "--no-optimise"])).toBe(0);
    expect(await manifestText(path.join(ws(), ".screens"))).toBe(
      await manifestText(path.join(flat, ".screens")),
    );
  });

  it("reads the explicit sources form to the same pack as the matrixFlow form", async () => {
    await runPack([ws(), "--no-optimise"]);
    const viaMatrixFlow = await manifestText(path.join(ws(), ".screens"));
    await setSources(ws(), {
      sources: {
        "login-desktop": { flow: "login", matrix: DESKTOP, variant: "en.light.1280" },
        "login-mobile": { flow: "login", matrix: MOBILE, variant: "es.dark.390" },
      },
    });
    expect(await runPack([ws(), "--no-optimise", "--out", path.join(root, "explicit")])).toBe(0);
    expect(await manifestText(path.join(root, "explicit"))).toBe(viaMatrixFlow);
  });

  it("packs a subset of the variants with explicit sources and leaves the others alone", async () => {
    await setSources(ws(), {
      sources: { only: { flow: "login", matrix: DESKTOP, variant: "en.light.1280" } },
    });
    const home = (await readWorkspace(ws()))[0]!.steps.find((s) => s.id === "home")!;
    expect(home.variants.map((v) => v.key)).toEqual(["en.light.1280"]);
  });

  it("combines explicit sources, a flat source and the matrixFlow block", async () => {
    await fs.cp(path.join(ws(), "docs", "login", MOBILE), path.join(ws(), "docs", "tablet"), {
      recursive: true,
    });
    const config = await fixtureConfig();
    config.matrixFlow.map = { [DESKTOP]: "en.light.1280" };
    config.sources = { tablet: { flow: "login", variant: "es.dark.768" } };
    // The mobile directory has no entry, so the block refuses it.
    await fs.writeFile(path.join(ws(), "pack.json"), JSON.stringify(config));
    await expect(readWorkspace(ws())).rejects.toThrow(new RegExp(`no pack key for ${MOBILE}`));
    config.matrixFlow.map = BOTH;
    config.sources = { tablet: { flow: "login", variant: "es.dark.768" } };
    await fs.writeFile(path.join(ws(), "pack.json"), JSON.stringify(config));
    const home = (await readWorkspace(ws()))[0]!.steps.find((s) => s.id === "home")!;
    expect(home.variants.map((v) => v.key).sort()).toEqual([
      "en.light.1280",
      "es.dark.390",
      "es.dark.768",
    ]);
  });

  it("maps a matrix flow whose name is not a pack flow id through packFlow", async () => {
    await fs.rename(path.join(ws(), "docs", "login"), path.join(ws(), "docs", "Login.v2"));
    await setSources(ws(), {
      matrixFlow: { flow: "Login.v2", packFlow: "login", map: BOTH },
    });
    const flows = await readWorkspace(ws());
    expect(flows.map((f) => f.id)).toEqual(["login"]);
    expect(flows[0]!.steps).toHaveLength(2);
  });

  it("still needs a text entry for every screenshot, and names the matrix directory", async () => {
    const config = await fixtureConfig();
    delete config.flows.login.steps.done;
    await fs.writeFile(path.join(ws(), "pack.json"), JSON.stringify(config));
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(
        `no flows\\["login"\\]\\.steps\\["done"\\] \\(screenshot login/${DESKTOP}/done\\.png\\)`,
      ),
    );
  });
});

describe("auto", () => {
  async function renameToPackKeys(): Promise<void> {
    const login = path.join(ws(), "docs", "login");
    await fs.rename(path.join(login, DESKTOP), path.join(login, "en.light.1280"));
    await fs.rename(path.join(login, MOBILE), path.join(login, "es.dark.390"));
  }

  it("maps ids that already read <locale>.<theme>.<viewport>", async () => {
    await renameToPackKeys();
    await setSources(ws(), { matrixFlow: { flow: "login", auto: true } });
    const home = (await readWorkspace(ws()))[0]!.steps.find((s) => s.id === "home")!;
    expect(home.variants.map((v) => v.key).sort()).toEqual(["en.light.1280", "es.dark.390"]);
  });

  it("lets map override auto for one id", async () => {
    await renameToPackKeys();
    await setSources(ws(), {
      matrixFlow: { flow: "login", auto: true, map: { "es.dark.390": "es.dark.360" } },
    });
    const home = (await readWorkspace(ws()))[0]!.steps.find((s) => s.id === "home")!;
    expect(home.variants.map((v) => v.key).sort()).toEqual(["en.light.1280", "es.dark.360"]);
  });

  it("fails on the ids it cannot map, listing them", async () => {
    await setSources(ws(), { matrixFlow: { flow: "login", auto: true } });
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(`no pack key for ${DESKTOP}, ${MOBILE}\\. Map each as`),
    );
    await renameToPackKeys();
    await fs.mkdir(path.join(ws(), "docs", "login", "fr.light.tablet-768", "screenshots"), {
      recursive: true,
    });
    await expect(readWorkspace(ws())).rejects.toThrow(/no pack key for fr\.light\.tablet-768\./);
  });
});

describe("variants that cannot be placed", () => {
  it("fails on a variant with no pack key and names it, with how to fix it", async () => {
    await setSources(ws(), mapOf({ [DESKTOP]: "en.light.1280" }));
    const failure = readWorkspace(ws());
    await expect(failure).rejects.toThrow(
      new RegExp(`matrixFlow "login": no pack key for ${MOBILE}`),
    );
    await expect(failure).rejects.toThrow(/or set "auto": true/);
  });

  it("fails when two matrix variants map to one pack key, naming both", async () => {
    await setSources(ws(), mapOf({ [DESKTOP]: "en.light.1280", [MOBILE]: "en.light.1280" }));
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(
        `docs/login/${DESKTOP}, docs/login/${MOBILE} all map to variant "en\\.light\\.1280"`,
      ),
    );
  });

  it("fails when an explicit source and the matrixFlow block map one variant twice", async () => {
    await setSources(ws(), {
      ...mapOf(BOTH),
      sources: { again: { flow: "login", matrix: DESKTOP, variant: "en.light.1280" } },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(`docs/login/${DESKTOP}, docs/login/${DESKTOP} all map to variant`),
    );
  });

  it("fails on a mapped id with no directory, naming it and listing what is there", async () => {
    await setSources(ws(), mapOf({ ...BOTH, "fr-FR.light.desktop-1280": "fr.light.1280" }));
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(
        `map names fr-FR\\.light\\.desktop-1280, not under docs/login/ \\(available: ${DESKTOP}, ${MOBILE}\\)`,
      ),
    );
  });

  it("fails on an explicit source whose variant directory is missing", async () => {
    await setSources(ws(), {
      sources: { x: { flow: "login", matrix: "en-US.dark.desktop-1280", variant: "en.dark.1280" } },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(
        `sources\\["x"\\]: no matrix variant "en-US\\.dark\\.desktop-1280" under docs/login/ \\(available: ${DESKTOP}, ${MOBILE}\\)`,
      ),
    );
  });

  it("says (available: none) when the matrix flow has no directory at all", async () => {
    await setSources(ws(), {
      sources: { x: { flow: "nope", matrix: DESKTOP, variant: "en.light.1280" } },
    });
    await expect(readWorkspace(ws())).rejects.toThrow(/under docs\/nope\/ \(available: none\)/);
    await setSources(ws(), { matrixFlow: { flow: "nope", auto: true } });
    await expect(readWorkspace(ws())).rejects.toThrow(
      /matrixFlow "nope": no variant directories under docs\/nope\//,
    );
  });

  it("does not take the screenshots directory of an unexpanded flow for a variant", async () => {
    await fs.mkdir(path.join(ws(), "docs", "plain", "screenshots"), { recursive: true });
    await setSources(ws(), { matrixFlow: { flow: "plain", auto: true } });
    await expect(readWorkspace(ws())).rejects.toThrow(/no variant directories under docs\/plain\//);
  });

  it("points a flat source at a matrix flow's directory to the matrix forms", async () => {
    await setSources(ws(), { sources: { login: { flow: "login", variant: "en.light.1280" } } });
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(
        `no screenshots under .*login.screenshots; docs/login/ has variant directories \\(${DESKTOP}, ${MOBILE}\\)`,
      ),
    );
  });

  it("exits 1 from pack and from pack --check with the same message", async () => {
    await setSources(ws(), mapOf({ [DESKTOP]: "en.light.1280" }));
    expect(await runPack([ws(), "--no-optimise"])).toBe(1);
    expect(err).toContain(`pack: pack.json: matrixFlow "login": no pack key for ${MOBILE}`);
    err = "";
    expect(await runDrift([ws(), "--against", path.join(root, "none")])).toBe(1);
    expect(err).toContain(`pack --check: pack.json: matrixFlow "login": no pack key for ${MOBILE}`);
  });
});

describe("the number of variant directories", () => {
  const fill = async (count: number): Promise<void> => {
    const dir = path.join(ws(), "docs", "many");
    await fs.mkdir(dir, { recursive: true });
    for (let i = 0; i < count; i++) await fs.mkdir(path.join(dir, `v${i}`));
    await setSources(ws(), { matrixFlow: { flow: "many", auto: true } });
  };

  it("reads up to the cap", async () => {
    await fill(MAX_VARIANT_DIRS);
    // The directories have no pack keys, which is the next check after the cap.
    await expect(readWorkspace(ws())).rejects.toThrow(/matrixFlow "many": no pack key for v0, /);
  });

  it("refuses a flow directory with more, without listing them", async () => {
    await fill(MAX_VARIANT_DIRS + 1);
    const error = await readWorkspace(ws()).catch((e: Error) => e);
    expect((error as Error).message).toBe(
      `docs/many/ has ${MAX_VARIANT_DIRS + 1} variant directories; pack reads at most ${MAX_VARIANT_DIRS}`,
    );
  });
});

describe("what error messages show", () => {
  it("strips control characters from a directory name it lists", async () => {
    await fs.mkdir(path.join(ws(), "docs", "login", "evil\n\u001b[31mx"));
    await setSources(ws(), { matrixFlow: { flow: "login", auto: true, map: BOTH } });
    const error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toMatch(/matrixFlow "login": no pack key for evil\[31mx\./);
    expect([...error.message].some((ch) => ch.charCodeAt(0) < 0x20)).toBe(false);
  });

  it("shows a workspace-relative path when the flow directory cannot be listed", async () => {
    await fs.rm(path.join(ws(), "docs", "login"), { recursive: true, force: true });
    await fs.writeFile(path.join(ws(), "docs", "login"), "not a directory");
    await setSources(ws(), mapOf(BOTH));
    const error = (await readWorkspace(ws()).catch((e: Error) => e)) as Error;
    expect(error.message).toBe("cannot read docs/login/ (ENOTDIR)");
  });
});

describe("symlinks under docs/", () => {
  /** Moves `dir` out of the workspace and leaves a symlink to it in its place. */
  async function linkAway(dir: string): Promise<void> {
    const elsewhere = path.join(root, `elsewhere-${path.basename(dir)}`);
    await fs.rename(dir, elsewhere);
    await fs.symlink(elsewhere, dir, "dir");
  }
  const variantDir = (id: string) => path.join(ws(), "docs", "login", id);

  it("skips a symlinked variant directory with a warning that names it", async () => {
    await linkAway(variantDir(MOBILE));
    await setSources(ws(), { matrixFlow: { flow: "login", map: { [DESKTOP]: "en.light.1280" } } });
    const warnings: string[] = [];
    const flows = await readWorkspace(ws(), (m) => warnings.push(m));
    expect(flows[0]!.steps.every((s) => s.variants.length === 1)).toBe(true);
    expect(warnings).toEqual([
      `docs/login/${MOBILE} is a symlink and was skipped; pack does not follow symlinks`,
    ]);
  });

  it("names a mapped variant that is a symlink in the warning next to the missing-variant error", async () => {
    await linkAway(variantDir(MOBILE));
    await setSources(ws(), mapOf(BOTH));
    const warnings: string[] = [];
    await expect(readWorkspace(ws(), (m) => warnings.push(m))).rejects.toThrow(
      new RegExp(`map names ${MOBILE}, not under docs/login/ \\(available: ${DESKTOP}\\)`),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`docs/login/${MOBILE}`);
  });

  it("prints the warning from pack", async () => {
    await linkAway(variantDir(MOBILE));
    await setSources(ws(), { matrixFlow: { flow: "login", map: { [DESKTOP]: "en.light.1280" } } });
    await runPack([ws(), "--no-optimise"]);
    expect(err).toContain(`warning: docs/login/${MOBILE} is a symlink and was skipped`);
  });

  it("refuses a symlinked matrix flow directory", async () => {
    await linkAway(path.join(ws(), "docs", "login"));
    await setSources(ws(), mapOf(BOTH));
    const error = await readWorkspace(ws()).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/^docs\/login is a symlink/);
  });

  it("refuses a symlinked screenshots directory under a variant", async () => {
    await linkAway(path.join(variantDir(DESKTOP), "screenshots"));
    await setSources(ws(), mapOf(BOTH));
    await expect(readWorkspace(ws())).rejects.toThrow(
      new RegExp(`docs/login/${DESKTOP}/screenshots is a symlink`),
    );
  });
});

describe("parsePackConfig, matrix forms", () => {
  const base = (): Obj => ({
    schema: SCHEMA,
    flows: { login: { steps: { home: { alt: { en: "Home" } } } } },
  });
  const withSources = (sources: Obj, extra: Obj = {}): Obj => ({ ...base(), sources, ...extra });
  const source = (extra: Obj = {}) => ({
    flow: "login",
    matrix: DESKTOP,
    variant: "en.light.1280",
    ...extra,
  });

  it("reads an explicit matrix source next to a flat one", () => {
    const parsed = parsePackConfig(
      withSources({
        a: source(),
        b: { flow: "app", variant: "en.dark.390" },
        c: source({ flow: "Login.v2", packFlow: "login" }),
      }),
    );
    expect(parsed.sources).toEqual({
      a: { flow: "login", matrix: DESKTOP, variant: "en.light.1280" },
      b: { flow: "app", variant: "en.dark.390" },
      c: { flow: "Login.v2", matrix: DESKTOP, variant: "en.light.1280", packFlow: "login" },
    });
    expect(parsed.matrixFlow).toBeUndefined();
  });

  it("reads matrixFlow without any sources", () => {
    const parsed = parsePackConfig({
      ...base(),
      matrixFlow: { flow: "login", auto: true, map: { [DESKTOP]: "en.light.1280" } },
    });
    expect(parsed.sources).toEqual({});
    expect(parsed.matrixFlow).toEqual({
      flow: "login",
      auto: true,
      map: { [DESKTOP]: "en.light.1280" },
    });
  });

  it.each<[string, Obj, RegExp]>([
    [
      "matrix not an id",
      withSources({ a: source({ matrix: "../x" }) }),
      /sources\["a"\]\.matrix must be a matrix variant id/,
    ],
    [
      "matrix is screenshots",
      withSources({ a: source({ matrix: "screenshots" }) }),
      /\.matrix must be a matrix variant id/,
    ],
    [
      "matrix not a string",
      withSources({ a: source({ matrix: 5 }) }),
      /\.matrix must be a matrix variant id/,
    ],
    [
      "variant not a pack key",
      withSources({ a: source({ variant: DESKTOP }) }),
      /sources\["a"\]\.variant must be <locale>\.<theme>\.<viewport>/,
    ],
    [
      "flow not a directory name",
      withSources({ a: source({ flow: "../x" }) }),
      /sources\["a"\]\.flow must be a matrix flow name/,
    ],
    [
      "flow not a pack flow id",
      withSources({ a: source({ flow: "Login" }) }),
      /sources\["a"\]\.flow "Login" is not a pack flow id; set packFlow/,
    ],
    [
      "packFlow not an id",
      withSources({ a: source({ packFlow: "Login" }) }),
      /\.packFlow must be a flow id/,
    ],
    ["matrixFlow not an object", { ...base(), matrixFlow: [] }, /matrixFlow must be an object/],
    [
      "matrixFlow without flow",
      { ...base(), matrixFlow: { auto: true } },
      /matrixFlow\.flow must be a matrix flow name/,
    ],
    [
      "matrixFlow with nothing to map",
      { ...base(), matrixFlow: { flow: "login" } },
      /matrixFlow needs "map" entries or "auto": true/,
    ],
    [
      "auto not a boolean",
      { ...base(), matrixFlow: { flow: "login", auto: "yes" } },
      /matrixFlow\.auto must be true or false/,
    ],
    [
      "map not an object",
      { ...base(), matrixFlow: { flow: "login", map: [] } },
      /matrixFlow\.map must be an object/,
    ],
    [
      "map key not an id",
      { ...base(), matrixFlow: { flow: "login", map: { "a/b": "en.light.1280" } } },
      /map key "a\/b" must be a matrix variant id/,
    ],
    [
      "map value not a pack key",
      { ...base(), matrixFlow: { flow: "login", map: { [DESKTOP]: "light" } } },
      new RegExp(`map\\["${DESKTOP}"\\] must be <locale>\\.<theme>\\.<viewport>`),
    ],
    [
      "a flat source and a matrixFlow that differ only by case",
      {
        ...withSources({ Login: { flow: "app", variant: "en.light.1280" } }),
        matrixFlow: { flow: "login", auto: true },
      },
      /sources\["Login"\] and matrixFlow "login" differ only by case/,
    ],
    [
      "a matrix source and a matrixFlow that differ only by case",
      {
        ...withSources({
          x: { flow: "Login", packFlow: "login", matrix: DESKTOP, variant: "en.light.1280" },
        }),
        matrixFlow: { flow: "login", auto: true },
      },
      /sources\["x"\]\.flow "Login" and matrixFlow "login" differ only by case/,
    ],
    ["no sources and no matrixFlow", withSources({}), /sources is empty/],
    ["sources missing and no matrixFlow", base(), /sources must be an object/],
  ])("refuses %s", (_name, config, message) => {
    expect(() => parsePackConfig(config)).toThrow(message);
  });
});
