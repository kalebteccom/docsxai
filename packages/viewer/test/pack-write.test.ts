import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listedFiles, writePack } from "../src/pack-write.js";

let root = "";
let outDir = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-write-"));
  outDir = path.join(root, "out");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => Buffer.from(text);
const files = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, bytes(v)]));
const exists = (...segments: string[]) =>
  fs.access(path.join(...segments)).then(
    () => true,
    () => false,
  );

/** A manifest of any shape that lists these `src`s, one step each. */
function manifestListing(...srcs: string[]): string {
  const variants = Object.fromEntries(srcs.map((src, i) => [`en.light.${390 + i}`, { src }]));
  return JSON.stringify({ flows: { f: { steps: { s: { variants } } } } });
}

async function seed(entries: Record<string, string>): Promise<void> {
  for (const [relative, text] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(outDir, relative)), { recursive: true });
    await fs.writeFile(path.join(outDir, relative), text);
  }
}

describe("writePack", () => {
  it("writes the files and the manifest, then writes nothing for the same input", async () => {
    const input = {
      outDir,
      files: files({ "b/two.00000002.png": "2", "a/one.00000001.png": "1" }),
      manifestText: "{}\n",
    };
    expect(await writePack(input)).toEqual({
      written: ["a/one.00000001.png", "b/two.00000002.png", "manifest.json"],
      removed: [],
    });
    expect(await fs.readFile(path.join(outDir, "a", "one.00000001.png"), "utf8")).toBe("1");
    expect(await fs.readFile(path.join(outDir, "manifest.json"), "utf8")).toBe("{}\n");
    expect(await writePack(input)).toEqual({ written: [], removed: [] });
  });

  it("rewrites a file whose bytes changed and a manifest whose text changed", async () => {
    await writePack({ outDir, files: files({ "a/one.00000001.png": "1" }), manifestText: "{}\n" });
    const result = await writePack({
      outDir,
      files: files({ "a/one.00000001.png": "changed" }),
      manifestText: '{ "x": 1 }\n',
    });
    expect(result.written).toEqual(["a/one.00000001.png", "manifest.json"]);
    expect(await fs.readFile(path.join(outDir, "a", "one.00000001.png"), "utf8")).toBe("changed");
  });

  it("removes exactly the files the previous manifest listed and the new pack dropped", async () => {
    await seed({
      "onboarding/pair.deadbeef.png": "old",
      "onboarding/keep.0badf00d.png": "listed in both",
      "gone/step.cafebabe.png": "old",
      "manifest.json": manifestListing(
        "/screens/onboarding/pair.deadbeef.png",
        "/screens/onboarding/keep.0badf00d.png",
        "/screens/gone/step.cafebabe.png",
      ),
      // Not listed anywhere: hashed-looking names, notes and a file at the root.
      "onboarding/other.cafe0000.png": "unlisted",
      "onboarding/notes.txt": "notes",
      "loose.12345678.png": "unlisted",
    });
    const result = await writePack({
      outDir,
      files: files({ "onboarding/keep.0badf00d.png": "listed in both" }),
      manifestText: "{}\n",
    });
    expect(result.removed).toEqual(["gone/step.cafebabe.png", "onboarding/pair.deadbeef.png"]);
    expect(await exists(outDir, "onboarding", "keep.0badf00d.png")).toBe(true);
    expect(await exists(outDir, "onboarding", "other.cafe0000.png")).toBe(true);
    expect(await exists(outDir, "onboarding", "notes.txt")).toBe(true);
    expect(await exists(outDir, "loose.12345678.png")).toBe(true);
    expect(await exists(outDir, "onboarding", "pair.deadbeef.png")).toBe(false);
  });

  it("removes a flow directory it emptied and leaves one that still holds files", async () => {
    await seed({
      "gone/step.cafebabe.png": "old",
      "kept/step.cafebabe.png": "old",
      "kept/notes.txt": "notes",
      "manifest.json": manifestListing(
        "/screens/gone/step.cafebabe.png",
        "/screens/kept/step.cafebabe.png",
      ),
    });
    await writePack({ outDir, files: files({}), manifestText: "{}\n" });
    expect(await exists(outDir, "gone")).toBe(false);
    expect(await exists(outDir, "kept", "notes.txt")).toBe(true);
    expect(await exists(outDir, "kept", "step.cafebabe.png")).toBe(false);
  });

  it("reads the files the previous manifest listed in either older shape", async () => {
    await seed({
      "desktop-1280/board.0123abcd.png": "v1",
      "manifest.json": JSON.stringify({
        schema: "docsxai/screens-pack@1",
        screens: {
          board: {
            variants: { "en.dark.1280": { src: "/screens/desktop-1280/board.0123abcd.png" } },
          },
        },
      }),
    });
    expect((await writePack({ outDir, files: files({}), manifestText: "{}\n" })).removed).toEqual([
      "desktop-1280/board.0123abcd.png",
    ]);

    await seed({
      "onboarding/pair.89abcdef.png": "m1",
      "manifest.json": JSON.stringify({
        schema: "docsxai/screens-manifest@1",
        flows: {
          onboarding: {
            steps: {
              pair: {
                variants: { "en.light.390": { src: "/screens/onboarding/pair.89abcdef.png" } },
              },
            },
          },
        },
      }),
    });
    expect((await writePack({ outDir, files: files({}), manifestText: "{}\n" })).removed).toEqual([
      "onboarding/pair.89abcdef.png",
    ]);
  });

  it("removes nothing when the previous manifest is missing or is not JSON", async () => {
    await seed({ "a/one.00000001.png": "x" });
    expect((await writePack({ outDir, files: files({}), manifestText: "{}\n" })).removed).toEqual(
      [],
    );
    await seed({ "manifest.json": "not json" });
    expect((await writePack({ outDir, files: files({}), manifestText: "{}\n" })).removed).toEqual(
      [],
    );
    expect(await exists(outDir, "a", "one.00000001.png")).toBe(true);
  });

  it("never touches a path outside the output directory, whatever the old manifest says", async () => {
    await fs.writeFile(path.join(root, "victim.0123abcd.png"), "keep");
    await seed({
      "manifest.json": manifestListing(
        "/screens/../victim.0123abcd.png",
        "../victim.0123abcd.png",
        "/screens/%2e%2e/victim.0123abcd.png",
      ),
    });
    expect((await writePack({ outDir, files: files({}), manifestText: "{}\n" })).removed).toEqual(
      [],
    );
    expect(await fs.readFile(path.join(root, "victim.0123abcd.png"), "utf8")).toBe("keep");
  });
});

describe("listedFiles", () => {
  it("returns the flow/file tail of every variant src, whatever the prefix", () => {
    expect(
      listedFiles(
        JSON.parse(
          manifestListing(
            "/screens/a/one.00000001.png",
            "/cdn/img/b/two.00000002.png",
            "c/three.00000003.png",
          ),
        ),
      ).sort(),
    ).toEqual(["a/one.00000001.png", "b/two.00000002.png", "c/three.00000003.png"]);
  });

  it("skips a src that is not hash-named and values that are not objects", () => {
    expect(listedFiles(JSON.parse(manifestListing("/screens/a/one.png", "/x")))).toEqual([]);
    expect(listedFiles(null)).toEqual([]);
    expect(listedFiles("text")).toEqual([]);
    expect(listedFiles({ variants: { k: null, j: { src: 5 } } })).toEqual([]);
  });

  it("stops descending past a fixed depth", () => {
    let deep: Record<string, unknown> = {
      variants: { k: { src: "/screens/a/one.00000001.png" } },
    };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    expect(listedFiles(deep)).toEqual([]);
  });
});
