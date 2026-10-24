// Two flow files that declare one `name:` write to one docs/<name>/ directory, so run, lint and
// flow-tree refuse them before anything launches or is read twice.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let ws = "";
let err = "";

const FLOW = (name: string) =>
  `name: ${name}\nlocators: { x: '#x' }\nsteps:\n  - id: a\n    action: click\n    target: $x\n`;

beforeEach(async () => {
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-dup-names-"));
  await fs.writeFile(path.join(ws, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
  await fs.mkdir(path.join(ws, "flows"));
  await fs.writeFile(path.join(ws, "flows", "a.flow.yaml"), FLOW("tour"), "utf8");
  await fs.writeFile(path.join(ws, "flows", "b.flow.yaml"), FLOW("tour"), "utf8");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

describe("two flow files with one name", () => {
  it.each(["run", "lint", "flow-tree"])("%s exits 1 and names both files", async (cmd) => {
    expect(await main([cmd, ws])).toBe(1);
    expect(err).toContain('flow name "tour" is declared by both');
    expect(err).toContain("a.flow.yaml");
    expect(err).toContain("b.flow.yaml");
  });

  it("run --flow refuses them too", async () => {
    expect(await main(["run", ws, "--flow", "tour"])).toBe(1);
    expect(err).toContain('flow name "tour" is declared by both');
  });
});
