import { afterEach, describe, expect, it, vi } from "vitest";
import { CLI_USAGE, parseCliArgs } from "../src/cli-args.js";
import { runBackendStubCli } from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

describe("parseCliArgs", () => {
  it("defaults to port 4477 and no data dir", () => {
    expect(parseCliArgs([], {})).toEqual({ ok: true, port: 4477, dataDir: undefined });
  });

  it("reads --flag=value and --flag value, keeping '=' inside a path", () => {
    expect(parseCliArgs(["--port=0", "--data-dir=/srv/a=b"], {})).toEqual({
      ok: true,
      port: 0,
      dataDir: "/srv/a=b",
    });
    expect(parseCliArgs(["--port", "4000", "--data-dir", "/srv/data"], {})).toEqual({
      ok: true,
      port: 4000,
      dataDir: "/srv/data",
    });
  });

  it("falls back to PORT and DOCSX_DATA_DIR; flags win", () => {
    const env = { PORT: "5000", DOCSX_DATA_DIR: "/env/dir" };
    expect(parseCliArgs([], env)).toEqual({ ok: true, port: 5000, dataDir: "/env/dir" });
    expect(parseCliArgs(["--port=6000", "--data-dir=/flag"], env)).toEqual({
      ok: true,
      port: 6000,
      dataDir: "/flag",
    });
  });

  it.each(["--port=abc", "--port=-1", "--port=65536", "--port=1e3", "--port=0x10"])(
    "rejects %s",
    (arg) => {
      const r = parseCliArgs([arg], {});
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.message).toContain("invalid port");
    },
  );

  it.each([["--port="], ["--port"], ["--port", "--data-dir=/x"], ["--data-dir"], ["--data-dir="]])(
    "rejects a missing value: %j",
    (...argv) => {
      const r = parseCliArgs(argv, {});
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.message).toContain("needs a value");
    },
  );

  it("rejects an unknown flag instead of ignoring it", () => {
    expect(parseCliArgs(["--data-dri=/x"], {})).toEqual({
      ok: false,
      message: 'unknown argument "--data-dri=/x"',
    });
  });
});

describe("runBackendStubCli", () => {
  it("exits 2 with a message for a port above 65535, without throwing", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(runBackendStubCli(["--port=70000"])).resolves.toBe(2);
    expect(String(err.mock.calls[0]?.[0])).toContain('invalid port "70000"');
    expect(String(err.mock.calls[0]?.[0])).toContain(CLI_USAGE);
  });
});
