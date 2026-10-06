// Lossless PNG optimisation through the external `oxipng` binary. The pack hashes the optimised
// bytes, so the optimiser is part of the output: same binary, same bytes. Nothing here is lossy
// (`--strip safe` drops only metadata chunks that cannot change how the image renders).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

export type Optimiser = (png: Buffer) => Promise<Buffer>;

export const OXIPNG_BIN_ENV = "DOCSX_OXIPNG_BIN";
export const OXIPNG_ARGS = ["-o", "4", "--strip", "safe"];
export const MISSING_OXIPNG = "oxipng not found on PATH. Install it with: brew install oxipng";

/** Leaves the bytes as the burner wrote them (`--no-optimise`). */
export const identityOptimiser: Optimiser = (png) => Promise.resolve(png);

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`)),
    );
  });
}

/** The command to run: `$DOCSX_OXIPNG_BIN` when set, else `oxipng` from PATH. */
export function oxipngCommand(env: Record<string, string | undefined> = process.env): string {
  return env[OXIPNG_BIN_ENV] || "oxipng";
}

/** Probes the binary once, then returns a function that optimises one PNG per call. */
export async function createOxipngOptimiser(command = "oxipng"): Promise<Optimiser> {
  try {
    await run(command, ["--version"]);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        command === "oxipng"
          ? MISSING_OXIPNG
          : `oxipng not found at ${command} (${OXIPNG_BIN_ENV})`,
      );
    }
    throw new Error(`${command} --version failed: ${(e as Error).message}`);
  }
  return async (png) => {
    const dir = await mkdtemp(path.join(tmpdir(), "docsxai-oxipng-"));
    const input = path.join(dir, "in.png");
    const output = path.join(dir, "out.png");
    try {
      await writeFile(input, png);
      await run(command, [...OXIPNG_ARGS, "--out", output, input]);
      return await readFile(output).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return png;
        throw e;
      });
    } finally {
      await unlink(input).catch(() => {});
      await unlink(output).catch(() => {});
      await rmdir(dir).catch(() => {});
    }
  };
}
