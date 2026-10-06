// `docsxai-viewer pack` and `drift` end to end through the command bodies: argv, a real raw
// capture or workspace on disk, the real burner, an oxipng stand-in, and the files and exit codes
// that come out. The engine's dispatch (flags handed to this bin) is tested in the engine package.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewerCli } from "../src/index.js";
import { runDrift, runPack } from "../src/pack-cli.js";
import type { ScreensPack } from "../src/pack-schema.js";
import { validatePack } from "../src/pack-validate.js";
import {
  packConfig,
  writeOxipngShim,
  writeRawCapture,
  writeWorkspace,
  type RawFlowSpec,
} from "./helpers/pack-fixtures.js";
import { layeredPng, solidPng } from "./helpers/png.js";

let out = "";
let err = "";
let root = "";
let raw = "";
let dest = "";

beforeEach(async () => {
  out = "";
  err = "";
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-cli-"));
  raw = path.join(root, "raw");
  dest = path.join(root, "dest");
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
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

const W = 240;
const H = 140;
const page = () => solidPng(W, H, [240, 240, 240, 255]);

function capture(extra: Record<string, unknown> = {}): Record<string, RawFlowSpec> {
  return {
    tour: {
      title: { en: "Tour" },
      steps: {
        home: {
          alt: { en: "Home page", es: "Pagina de inicio" },
          variants: {
            "en.light.390": {
              png: page(),
              sidecar: {
                annotations: [
                  {
                    index: 1,
                    copy: "Scan the code",
                    bbox: { x: 20, y: 20, width: 60, height: 30 },
                  },
                ],
                ...extra,
              },
            },
            "es.dark.1280": { png: solidPng(W, H, [20, 20, 20, 255]) },
          },
        },
        done: { alt: { en: "All set" }, variants: { "en.light.390": { png: page() } } },
      },
    },
  };
}

const readPack = async (dir = dest) =>
  JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as ScreensPack;
const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

describe("argument handling", () => {
  it.each<[string[], RegExp]>([
    [[], /pack: missing <workspace-or-raw-dir>/],
    [["d", "--frobnicate"], /pack: unknown flag --frobnicate/],
    [["d", "--out"], /pack: --out needs a value/],
    [["d", "--out", "--no-optimise"], /pack: --out needs a value/],
    [["d", "--public-prefix"], /--public-prefix needs a value/],
    [["d", "e"], /pack: unexpected argument "e"/],
    [["d", "--against", "x"], /pack: unknown flag --against/],
  ])("pack %j exits 2 with the usage", async (argv, message) => {
    expect(await runPack(argv)).toBe(2);
    expect(err).toMatch(message);
    expect(err).toContain("docsxai-viewer pack <workspace-or-raw-dir>");
  });

  it.each<[string[], RegExp]>([
    [[], /pack --check: missing <workspace-or-raw-dir>/],
    [["d"], /pack --check: --against <pack-dir> is required/],
    [["d", "--against"], /--against needs a value/],
    [["d", "--against", "p", "--threshold", "-1"], /--threshold needs a percentage >= 0/],
    [["d", "--against", "p", "--threshold", "x"], /--threshold needs a percentage >= 0/],
    [["d", "--against", "p", "--out", "o"], /pack --check: unknown flag --out/],
  ])("pack --check %j exits 2 with the usage", async (argv, message) => {
    expect(await runDrift(argv)).toBe(2);
    expect(err).toMatch(message);
  });

  it("the viewer bin routes pack and pack --check and lists them in its help", async () => {
    expect(await runViewerCli(["pack"])).toBe(2);
    expect(await runViewerCli(["pack", "--check"])).toBe(2);
    out = "";
    expect(await runViewerCli(["--help"])).toBe(2);
    expect(out).toContain("docsxai-viewer pack <workspace-or-raw-dir> [--from-raw]");
    expect(out).toContain(
      "docsxai-viewer pack <workspace-or-raw-dir> --check --against <pack-dir>",
    );
    expect(out).not.toContain("docsxai-viewer drift");
  });

  it("a raw capture needs --out, and a path that is not a directory exits 1", async () => {
    await writeRawCapture(raw, capture());
    expect(await runPack([raw, "--no-optimise"])).toBe(2);
    expect(err).toMatch(/--out is required when <dir> is a raw capture directory/);
    err = "";
    expect(await runPack([path.join(root, "nope"), "--no-optimise", "--out", dest])).toBe(1);
    expect(err).toMatch(/pack: .*nope is not a directory/);
  });
});

describe("pack from a raw capture", () => {
  it("writes hash-named PNGs and a valid manifest, then writes nothing the second time", async () => {
    await writeRawCapture(raw, capture());
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(0);
    expect(out).toBe(`pack: 3 image(s), 4 written, 0 removed in ${dest}\n`);

    const pack = await readPack();
    expect(validatePack(pack, { publicPrefix: "/screens" })).toEqual({ ok: true, errors: [] });
    const home = pack.flows.tour!.steps.home!;
    expect(Object.keys(home.variants).sort()).toEqual(["en.light.390", "es.dark.1280"]);
    expect(home.variants["en.light.390"]!.callouts).toEqual([
      { index: 1, copy: "Scan the code", bbox: { x: 20, y: 20, width: 60, height: 30 } },
    ]);
    for (const v of Object.values(home.variants)) {
      expect(await exists(path.join(dest, v.src.replace(/^\/screens\//, "")))).toBe(true);
    }
    // The burned variant is not the capture; the one with nothing to draw is.
    const burned = await fs.readFile(path.join(dest, home.variants["en.light.390"]!.src.slice(9)));
    expect(burned.equals(page())).toBe(false);
    const clean = await fs.readFile(
      path.join(dest, pack.flows.tour!.steps.done!.variants["en.light.390"]!.src.slice(9)),
    );
    expect(clean.equals(page())).toBe(true);

    out = "";
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(0);
    expect(out).toBe(`pack: 3 image(s), 0 written, 0 removed in ${dest}\n`);
  });

  it("builds the same manifest text from the same capture in another directory", async () => {
    await writeRawCapture(raw, capture());
    await runPack([raw, "--no-optimise", "--out", dest]);
    const other = path.join(root, "other");
    await runPack([raw, "--no-optimise", "--out", other]);
    expect(await fs.readFile(path.join(other, "manifest.json"), "utf8")).toBe(
      await fs.readFile(path.join(dest, "manifest.json"), "utf8"),
    );
  });

  it("--public-prefix and --generated-for reach the manifest", async () => {
    await writeRawCapture(raw, capture());
    expect(
      await runPack([
        raw,
        "--no-optimise",
        "--out",
        dest,
        "--public-prefix",
        "/img",
        "--generated-for",
        "abc123",
      ]),
    ).toBe(0);
    const pack = await readPack();
    expect(pack.generated_for).toBe("abc123");
    expect(pack.flows.tour!.steps.done!.variants["en.light.390"]!.src).toMatch(
      /^\/img\/tour\/done\.[0-9a-f]{8}\.png$/,
    );
    err = "";
    expect(await runPack([raw, "--no-optimise", "--out", dest, "--public-prefix", "/a/../b"])).toBe(
      1,
    );
    expect(err).toMatch(/not a plain URL path/);
  });

  it("removes the files of a step that left the capture, by the exact path the old manifest listed", async () => {
    await writeRawCapture(raw, capture());
    await runPack([raw, "--no-optimise", "--out", dest]);
    const before = await readPack();
    const doneFile = before.flows.tour!.steps.done!.variants["en.light.390"]!.src.slice(9);
    await fs.writeFile(path.join(dest, "tour", "notes.txt"), "keep me");
    await fs.writeFile(path.join(dest, "tour", "other.deadbeef.png"), "not listed");

    await fs.rm(path.join(raw, "tour", "done"), { recursive: true });
    out = "";
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(0);
    expect(out).toContain("2 image(s), 1 written, 1 removed");
    expect(await exists(path.join(dest, doneFile))).toBe(false);
    expect(await fs.readFile(path.join(dest, "tour", "notes.txt"), "utf8")).toBe("keep me");
    expect(await exists(path.join(dest, "tour", "other.deadbeef.png"))).toBe(true);
  });

  it("stops on a loopback address in the text and writes nothing", async () => {
    const spec = capture();
    spec.tour!.steps.home!.alt.en = "Open http://localhost:3000";
    await writeRawCapture(raw, spec);
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(1);
    expect(err).toMatch(/pack: pack guard stopped the build:\n {2}- .*alt\.en: loopback host/);
    expect(await exists(dest)).toBe(false);
  });

  it("reads a capture that has a flow called docs only with --from-raw", async () => {
    const spec = capture();
    await writeRawCapture(raw, { docs: spec.tour! });
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(1);
    expect(err).toMatch(/has docs\/ but no pack\.json/);
    err = "";
    expect(await runPack([raw, "--from-raw", "--no-optimise", "--out", dest])).toBe(0);
    expect(Object.keys((await readPack()).flows)).toEqual(["docs"]);
  });
});

describe("optimising", () => {
  it("fails with the install hint when oxipng is missing and --no-optimise is not given", async () => {
    await writeRawCapture(raw, capture());
    vi.stubEnv("PATH", "");
    vi.stubEnv("DOCSX_OXIPNG_BIN", "");
    expect(await runPack([raw, "--out", dest])).toBe(1);
    expect(err).toBe("pack: oxipng not found on PATH. Install it with: brew install oxipng\n");
    expect(await exists(dest)).toBe(false);
  });

  it("runs the binary named by DOCSX_OXIPNG_BIN and names files after its output", async () => {
    await writeRawCapture(raw, capture());
    const shim = await writeOxipngShim(root);
    vi.stubEnv("DOCSX_OXIPNG_BIN", shim.command);
    expect(await runPack([raw, "--out", dest])).toBe(0);
    expect(await shim.calls()).toHaveLength(3);
    const pack = await readPack();
    for (const v of Object.values(pack.flows.tour!.steps.home!.variants)) {
      const bytes = await fs.readFile(path.join(dest, v.src.slice(9)));
      expect(bytes.includes(Buffer.from("docsxai-shim"))).toBe(true);
      expect(v.bytes).toBe(bytes.length);
    }
  });
});

describe("pack from a workspace", () => {
  const ws = () => path.join(root, "ws");

  async function workspace(): Promise<void> {
    await writeWorkspace(ws(), {
      config: packConfig({ "desktop-1280": "en.dark.1280", "mobile-390": "en.dark.390" }, [
        "board",
      ]),
      shots: {
        "desktop-1280": { board: page() },
        "mobile-390": { board: solidPng(W, H, [30, 30, 30, 255]) },
      },
      annotations: {
        "desktop-1280": [
          {
            step: "board",
            selector: "#a",
            copy: "The board",
            bounding_box: { x: 20, y: 20, width: 60, height: 30 },
          },
        ],
      },
    });
  }

  it("defaults the output to <workspace>/.screens and merges capture flows into one flow", async () => {
    await workspace();
    expect(await runPack([ws(), "--no-optimise"])).toBe(0);
    const pack = await readPack(path.join(ws(), ".screens"));
    expect(Object.keys(pack.flows)).toEqual(["app"]);
    expect(Object.keys(pack.flows.app!.steps.board!.variants).sort()).toEqual([
      "en.dark.1280",
      "en.dark.390",
    ]);
    expect(pack.flows.app!.steps.board!.alt).toEqual({ en: "The board page" });
    expect(pack.flows.app!.steps.board!.variants["en.dark.1280"]!.callouts).toEqual([
      { index: 1, copy: "The board", bbox: { x: 20, y: 20, width: 60, height: 30 } },
    ]);
  });

  it("exits 1 with the fix when pack.json is missing", async () => {
    await fs.mkdir(path.join(ws(), "docs"), { recursive: true });
    expect(await runPack([ws(), "--no-optimise"])).toBe(1);
    expect(err).toMatch(/has docs\/ but no pack\.json\. Add one \(docsxai\/pack-config@1\)/);
  });
});

describe("pack --check", () => {
  async function commit(): Promise<void> {
    await writeRawCapture(raw, capture());
    expect(await runPack([raw, "--no-optimise", "--out", dest])).toBe(0);
    out = "";
  }

  it("exits 0 and says nothing drifted for the same capture", async () => {
    await commit();
    expect(await runDrift([raw, "--against", dest])).toBe(0);
    expect(out).toBe("docsxai drift: 3 compared, 0 over threshold (0.5%)\n");
  });

  it("exits 1 for a change over the threshold, with the region, and 0 when the threshold allows it", async () => {
    await commit();
    await fs.writeFile(
      path.join(raw, "tour", "done", "en.light.390.png"),
      layeredPng(W, H, 240, [{ x: 10, y: 10, width: 60, height: 60, grey: 0 }]),
    );
    expect(await runDrift([raw, "--against", dest])).toBe(1);
    expect(out).toContain("docsxai drift: 3 compared, 1 over threshold (0.5%)");
    expect(out).toMatch(
      /changed {2}tour\/done\/en\.light\.390 {2}10\.7143% {2}region 10,10 60x60 {2}OVER\n$/,
    );
    out = "";
    expect(await runDrift([raw, "--against", dest, "--threshold", "100"])).toBe(0);
    expect(out).toContain("(100%)");
    expect(out).not.toContain("OVER");
  });

  it("is what `pack <dir> --check` runs", async () => {
    await commit();
    expect(await runPack([raw, "--check", "--against", dest])).toBe(0);
    expect(out).toBe("docsxai drift: 3 compared, 0 over threshold (0.5%)\n");
    out = "";
    expect(await runPack(["--check", raw, "--against", dest, "--threshold", "2"])).toBe(0);
    expect(out).toContain("(2%)");
  });

  it("exits 1 for a new variant and for a missing one", async () => {
    await commit();
    await fs.rm(path.join(raw, "tour", "done"), { recursive: true });
    expect(await runDrift([raw, "--against", dest])).toBe(1);
    expect(out).toMatch(/missing {2}tour\/done\/en\.light\.390/);
  });

  it("exits 1 with a message when there is no committed pack", async () => {
    await writeRawCapture(raw, capture());
    expect(await runDrift([raw, "--against", path.join(root, "none")])).toBe(1);
    expect(err).toMatch(/pack --check: no manifest\.json in /);
  });

  it("does not need oxipng and writes nothing", async () => {
    await commit();
    vi.stubEnv("PATH", "");
    vi.stubEnv("DOCSX_OXIPNG_BIN", "");
    const before = (await fs.readdir(dest, { recursive: true })).sort();
    expect(await runDrift([raw, "--against", dest])).toBe(0);
    expect((await fs.readdir(dest, { recursive: true })).sort()).toEqual(before);
  });

  it("compares a workspace the same way", async () => {
    const ws = path.join(root, "ws");
    await writeWorkspace(ws, {
      config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
      shots: { "desktop-1280": { board: page() } },
    });
    expect(await runPack([ws, "--no-optimise"])).toBe(0);
    out = "";
    expect(await runDrift([ws, "--against", path.join(ws, ".screens")])).toBe(0);
    expect(out).toBe("docsxai drift: 1 compared, 0 over threshold (0.5%)\n");
  });
});
