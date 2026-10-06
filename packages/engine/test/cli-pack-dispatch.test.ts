// Dispatch + argument-contract tests for `docsxai pack`, `docsxai pack --check` and the retired `docsxai drift`: the argv edge, the
// flags handed to the viewer bin (a fake script records its argv), exit codes, and the help text.
// What the viewer does with them is tested in packages/viewer/test/pack-*.test.ts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { resetDeprecationWarnings } from "../src/deprecation.js";

let out = "";
let err = "";
let tmp = "";

beforeEach(async () => {
  resetDeprecationWarnings();
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
  it("lists pack and pack --check with their flags, and no drift command", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out).toContain(
      "docsxai pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]",
    );
    expect(out).toContain(
      "docsxai pack <workspace-or-raw-dir> --check --against <pack-dir> [--from-raw] [--threshold <pct>]",
    );
    expect(out).not.toContain("docsxai drift <workspace-or-raw-dir>");
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

describe("pack --check dispatch", () => {
  it("without a directory exits 2 with the usage", async () => {
    expect(await main(["pack", "--check"])).toBe(2);
    expect(err).toMatch(/pack --check: missing <workspace-or-raw-dir>/);
  });

  it("requires --against and a sane --threshold", async () => {
    const cases: Array<[string[], RegExp]> = [
      [["pack", "ws", "--check"], /--against <pack-dir> is required/],
      [["pack", "ws", "--check", "--against"], /--against needs a value/],
      [
        ["pack", "ws", "--check", "--against", "p", "--threshold", "-1"],
        /--threshold needs a percentage >= 0/,
      ],
      [
        ["pack", "ws", "--check", "--against", "p", "--threshold", "lots"],
        /--threshold needs a percentage >= 0/,
      ],
      [["pack", "ws", "--check", "--against", "p", "--out", "x"], /unknown flag --out/],
    ];
    for (const [argv, message] of cases) {
      err = "";
      expect(await main(argv)).toBe(2);
      expect(err).toMatch(message);
    }
  });

  it("runs the viewer's pack --check with the flags it was given, wherever --check sits", async () => {
    const { argvFile } = await fakeViewer();
    expect(
      await main([
        "pack",
        "--check",
        "--from-raw",
        "raw",
        "--against",
        "pack",
        "--threshold",
        "1.5",
      ]),
    ).toBe(0);
    expect(await argvOf(argvFile)).toEqual([
      "pack",
      "raw",
      "--check",
      "--from-raw",
      "--against",
      "pack",
      "--threshold",
      "1.5",
    ]);
  });

  it("propagates a non-zero exit (drift over the threshold)", async () => {
    await fakeViewer(1);
    expect(await main(["pack", "ws", "--check", "--against", "pack"])).toBe(1);
  });
});

describe("the retired drift command", () => {
  it("warns once with the replacement and runs pack --check with the same arguments", async () => {
    const { argvFile } = await fakeViewer();
    expect(await main(["drift", "ws", "--against", "pack", "--threshold", "2"])).toBe(0);
    expect(err).toBe(
      "docsxai: the drift command is deprecated since 0.3.0, use `docsxai pack --check` (same flags, `--check` added)\n",
    );
    expect(await argvOf(argvFile)).toEqual([
      "pack",
      "ws",
      "--check",
      "--against",
      "pack",
      "--threshold",
      "2",
    ]);
  });

  it("warns once per invocation, not once per call", async () => {
    await fakeViewer();
    await main(["drift", "ws", "--against", "pack"]);
    await main(["drift", "ws", "--against", "pack"]);
    expect(err.match(/is deprecated since/g)).toHaveLength(1);
  });

  it("keeps the exit codes of pack --check: 2 for a bad argument, the viewer's code otherwise", async () => {
    expect(await main(["drift"])).toBe(2);
    expect(err).toMatch(/pack --check: missing <workspace-or-raw-dir>/);
    await fakeViewer(1);
    expect(await main(["drift", "ws", "--against", "pack"])).toBe(1);
  });
});
