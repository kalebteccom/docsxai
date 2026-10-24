import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createBackendStub, runBackendStubCli } from "../src/index.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-cli-startup-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe("runBackendStubCli startup failures", () => {
  it("exits 1 with a clear message when the port is already in use", async () => {
    const busy = createBackendStub();
    const port = new URL(await busy.listen(0)).port;
    try {
      const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      await expect(runBackendStubCli([`--port=${port}`])).resolves.toBe(1);
      const text = String(err.mock.calls[0]?.[0]);
      expect(text).toContain(`127.0.0.1:${port}`);
      expect(text).toContain("already in use");
    } finally {
      await busy.close();
    }
  });

  it("exits 1 naming the path when --data-dir is a file", async () => {
    const file = path.join(tmp, "not-a-dir");
    fs.writeFileSync(file, "");
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runBackendStubCli([`--data-dir=${file}`, "--port=0"])).resolves.toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toContain(`cannot use data dir "${file}"`);
  });
});
