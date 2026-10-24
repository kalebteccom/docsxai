// A <workspace-dir> that does not exist, or is a file, stops the commands that write into it.
// `export`, `style` and `baseline` used to exit 0 and create the directory (with `.export/`,
// `docs/style.yaml` or `.baseline/` in it); `push` and `pull` blamed a missing `.docsxai.json`.
// Nothing is stubbed; every case fails before any network or browser call.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let err = "";
let tmp = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-wsdir-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const COMMANDS: string[][] = [
  ["export", "adf"],
  ["export", "playwright"],
  ["style"],
  ["baseline"],
  ["push"],
  ["pull"],
];
const label = (cmd: string[]) => cmd.join(" ");

describe("a workspace directory that does not exist", () => {
  it.each(COMMANDS.map((c) => [label(c), c] as const))(
    "%s names it, gives the init command, exits 1 and creates nothing",
    async (_name, cmd) => {
      const dir = path.join(tmp, "nowhere");
      expect(await main([...cmd, dir])).toBe(1);
      expect(err).toContain(`${label(cmd)}: workspace doesn't exist: ${dir}`);
      expect(err).toContain(`next: docsxai init ${dir}  (or fix the path)`);
      await expect(fs.access(dir)).rejects.toThrow();
    },
  );
});

describe("a workspace path that is a file", () => {
  it.each(COMMANDS.map((c) => [label(c), c] as const))(
    "%s names the file and exits 1",
    async (_name, cmd) => {
      const file = path.join(tmp, "notes.txt");
      await fs.writeFile(file, "x");
      expect(await main([...cmd, file])).toBe(1);
      expect(err).toContain(`${label(cmd)}: ${file} is a file, not a workspace directory`);
      expect(err).toContain("next: docsxai init <new-dir>, or pass the workspace directory");
      expect(err).not.toContain("docsxai:");
    },
  );
});
