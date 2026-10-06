// Dispatch + argument-contract tests for `docsxai pack` and `docsxai drift`: the argv edge, the
// flags handed to the viewer bin (a fake script records its argv), exit codes, and the help text.
// What the viewer does with them is tested in packages/viewer/test/pack-*.test.ts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let out = "";
let err = "";
let tmp = "";

beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cli-pack-"));
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
  await fs.rm(tmp, { recursive: true, force: true });
});

async function fakeViewer(exitCode = 0): Promise<{ argvFile: string }> {
  const argvFile = path.join(tmp, "viewer-argv.json");
  const script = path.join(tmp, "fake-viewer.js");
  await fs.writeFile(
    script,
    `require("node:fs").writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(${exitCode});\n`,
    "utf8",
  );
  vi.stubEnv("DOCSX_VIEWER_BIN", script);
  return { argvFile };
}
const argvOf = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as string[];

describe("help", () => {
  it("lists pack and drift with their flags", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out).toContain(
      "docsxai pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]",
    );
    expect(out).toContain(
      "docsxai drift <workspace-or-raw-dir> --against <pack-dir> [--from-raw] [--threshold <pct>]",
    );
    expect(out).toContain("brew install oxipng");
  });
});

describe("pack dispatch", () => {
  it("without a directory exits 2 with the usage", async () => {
    expect(await main(["pack"])).toBe(2);
    expect(err).toMatch(/pack: missing <workspace-or-raw-dir>/);
    expect(err).toMatch(/docsxai pack <workspace-or-raw-dir>/);
  });

  it("rejects unknown flags, flags without a value and a second positional", async () => {
    const cases: Array<[string[], RegExp]> = [
      [["pack", "d", "--frobnicate"], /unknown flag --frobnicate/],
      [["pack", "d", "--out"], /--out needs a value/],
      [["pack", "d", "--public-prefix", "--no-optimise"], /--public-prefix needs a value/],
      [["pack", "d", "--generated-for"], /--generated-for needs a value/],
      [["pack", "d", "other"], /unexpected argument "other"/],
      [["pack", "d", "--against", "x"], /unknown flag --against/],
    ];
    for (const [argv, message] of cases) {
      err = "";
      expect(await main(argv)).toBe(2);
      expect(err).toMatch(message);
    }
  });

  it("runs the viewer's pack with only the flags it was given", async () => {
    const { argvFile } = await fakeViewer();
    expect(await main(["pack", "ws"])).toBe(0);
    expect(await argvOf(argvFile)).toEqual(["pack", "ws"]);
  });

  it("passes every flag through, wherever the directory sits", async () => {
    const { argvFile } = await fakeViewer();
    const argv = [
      "pack",
      "--no-optimise",
      "ws",
      "--from-raw",
      "--out",
      "dist/screens",
      "--public-prefix",
      "/img",
      "--generated-for",
      "abc123",
    ];
    expect(await main(argv)).toBe(0);
    expect(await argvOf(argvFile)).toEqual([
      "pack",
      "ws",
      "--no-optimise",
      "--from-raw",
      "--out",
      "dist/screens",
      "--public-prefix",
      "/img",
      "--generated-for",
      "abc123",
    ]);
  });

  it("propagates the viewer's exit code", async () => {
    await fakeViewer(4);
    expect(await main(["pack", "ws"])).toBe(4);
  });

  it("lists the viewer resolution attempts when no viewer is found", async () => {
    vi.stubEnv("DOCSX_VIEWER_BIN", path.join(tmp, "no-such-viewer.js"));
    vi.stubEnv("PATH", "");
    expect(await main(["pack", "ws"])).toBe(1);
    expect(err).toMatch(/pack: .*could not be launched/s);
  });
});

describe("drift dispatch", () => {
  it("without a directory exits 2 with the usage", async () => {
    expect(await main(["drift"])).toBe(2);
    expect(err).toMatch(/drift: missing <workspace-or-raw-dir>/);
  });

  it("requires --against and a sane --threshold", async () => {
    const cases: Array<[string[], RegExp]> = [
      [["drift", "ws"], /--against <pack-dir> is required/],
      [["drift", "ws", "--against"], /--against needs a value/],
      [
        ["drift", "ws", "--against", "p", "--threshold", "-1"],
        /--threshold needs a percentage >= 0/,
      ],
      [
        ["drift", "ws", "--against", "p", "--threshold", "lots"],
        /--threshold needs a percentage >= 0/,
      ],
      [["drift", "ws", "--against", "p", "--out", "x"], /unknown flag --out/],
    ];
    for (const [argv, message] of cases) {
      err = "";
      expect(await main(argv)).toBe(2);
      expect(err).toMatch(message);
    }
  });

  it("runs the viewer's drift with the flags it was given", async () => {
    const { argvFile } = await fakeViewer();
    expect(
      await main(["drift", "--from-raw", "raw", "--against", "pack", "--threshold", "1.5"]),
    ).toBe(0);
    expect(await argvOf(argvFile)).toEqual([
      "drift",
      "raw",
      "--from-raw",
      "--against",
      "pack",
      "--threshold",
      "1.5",
    ]);
  });

  it("propagates a non-zero exit (drift over the threshold)", async () => {
    await fakeViewer(1);
    expect(await main(["drift", "ws", "--against", "pack"])).toBe(1);
  });
});
