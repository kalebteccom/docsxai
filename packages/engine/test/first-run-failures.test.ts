// First-run failures that stop before a browser starts: `init`, `login`, and the start-up checks
// of `run`. Each case names the cause, the file or flag involved, the exit code and the one
// command to run next. Nothing is stubbed; every case fails before any network or browser call.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let err = "";
let tmp = "";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-first-run-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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

describe("init", () => {
  it("rejects an --app-url that is not an http(s) URL with exit 2 and writes nothing", async () => {
    for (const bad of ["notaurl", "ftp://host/app"]) {
      err = "";
      const ws = path.join(tmp, "ws");
      expect(await main(["init", ws, "--app-url", bad])).toBe(2);
      expect(err).toContain("init: --app-url must be an http:// or https:// URL");
      expect(err).toContain("usage: docsxai init");
      await expect(fs.access(ws)).rejects.toThrow();
    }
  });

  it("says a path that is a file is not a directory", async () => {
    const file = path.join(tmp, "notes.txt");
    await fs.writeFile(file, "x");
    expect(await main(["init", file])).toBe(1);
    expect(err).toContain(`init: ${file} is a file, not a directory`);
    expect(err).toContain("next: docsxai init <new-dir>");
    expect(err).not.toContain("ENOTDIR");
  });

  it.skipIf(isRoot)(
    "points chmod at the existing parent when the new directory cannot be made",
    async () => {
      const parent = path.join(tmp, "locked");
      await fs.mkdir(parent, { mode: 0o555 });
      try {
        expect(await main(["init", path.join(parent, "ws")])).toBe(1);
        expect(err).toContain("EACCES");
        expect(err).toContain(`next: chmod u+rwx ${parent}  (or pick another directory)`);
        expect(err).not.toContain(`chmod -R u+rw ${path.join(parent, "ws")}`);
      } finally {
        await fs.chmod(parent, 0o755);
      }
    },
  );
});

describe("login", () => {
  it.each(["notaurl", "ftp://host"])("rejects --backend-url %s as a usage error", async (bad) => {
    for (const token of [undefined, "t0ken"]) {
      err = "";
      vi.unstubAllEnvs();
      if (token) vi.stubEnv("DOCSX_TOKEN", token);
      else vi.stubEnv("DOCSX_TOKEN", "");
      expect(await main(["login", "--backend-url", bad])).toBe(2);
      expect(err).toContain("login: --backend-url must be an http:// or https:// URL");
      expect(err).toContain("usage: docsxai login");
    }
  });
});

describe("run start-up", () => {
  const FLOW =
    "name: f\nlocators: { b: '#b' }\nsteps:\n  - id: s\n    action: hover\n    target: $b\n    success: { visible: $b }\n";

  async function workspace(...initArgs: string[]): Promise<string> {
    const ws = path.join(tmp, "ws");
    expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1", ...initArgs])).toBe(0);
    await fs.writeFile(path.join(ws, "flows", "f.flow.yaml"), FLOW);
    err = "";
    return ws;
  }

  it("a workspace whose flows/ was deleted says to recreate it, not to run init again", async () => {
    const ws = await workspace();
    await fs.rm(path.join(ws, "flows"), { recursive: true });
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain(`run: workspace ${ws} has no flows/ directory`);
    expect(err).toContain(`next: mkdir ${path.join(ws, "flows")}`);
    expect(err).not.toContain("docsxai init");
  });

  it("a non-empty directory without .docsxai.json says it is not a workspace", async () => {
    const dir = path.join(tmp, "other");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "notes.txt"), "x");
    expect(await main(["run", dir])).toBe(1);
    expect(err).toContain(`run: ${dir} is not a docsxai workspace (no .docsxai.json, no flows/)`);
    expect(err).toContain(`next: docsxai init <new-dir>, or pass the workspace directory`);
  });

  it("an empty directory is offered to init", async () => {
    const dir = path.join(tmp, "empty");
    await fs.mkdir(dir);
    expect(await main(["run", dir])).toBe(1);
    expect(err).toContain(`next: docsxai init ${dir}`);
  });

  it("an app_url that is not a URL stops the run and names the file and key", async () => {
    const ws = await workspace("--auth", "none");
    const file = path.join(ws, ".docsxai.json");
    const cfg = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...cfg, app_url: "localhost:3000" }));
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain(`run: app_url in ${file} is not an http://, https:// or file:// URL`);
    expect(err).toContain(`next: fix app_url in ${file}, or pass --base-url <url>`);
  });

  it("a --base-url that is not a URL is a usage error", async () => {
    const ws = await workspace("--auth", "none");
    expect(await main(["run", ws, "--base-url", "localhost:3000"])).toBe(2);
    expect(err).toContain("run: --base-url must be an http://, https:// or file:// URL");
  });

  it.each(["ftp://host/x", "javascript:alert(1)", "data:text/html,hi", "mailto:a@b.c"])(
    "a --base-url of %s is a usage error",
    async (bad) => {
      const ws = await workspace("--auth", "none");
      expect(await main(["run", ws, "--base-url", bad])).toBe(2);
      expect(err).toContain("run: --base-url must be an http://, https:// or file:// URL");
    },
  );

  it("a file:// --base-url passes URL validation", async () => {
    const ws = await workspace("--auth", "none");
    await main(["run", ws, "--base-url", "file:///nonexistent/site/index.html"]);
    expect(err).not.toContain("--base-url must be");
  });

  it("a cached session that is not valid JSON is called corrupt, not expired", async () => {
    const ws = await workspace();
    const session = path.join(ws, ".auth", "editor.json");
    await fs.writeFile(session, "{not json");
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain(`no valid cached session at ${session} (the file is corrupt)`);
    expect(err).toContain(`next: docsxai capture-auth ${ws}`);
  });

  it("a cached session past its expiry still says expired", async () => {
    const ws = await workspace();
    const stale = { storageState: { cookies: [], origins: [] }, writtenAt: 1, expiresAt: 2 };
    await fs.writeFile(path.join(ws, ".auth", "editor.json"), JSON.stringify(stale));
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain("(missing or expired)");
  });

  it.skipIf(isRoot)(
    "an unreadable .docsxai.json is a warning that names EACCES, not silence",
    async () => {
      const ws = await workspace("--auth", "none");
      const file = path.join(ws, ".docsxai.json");
      await fs.rm(path.join(ws, "flows"), { recursive: true, force: true });
      await fs.chmod(file, 0o000);
      try {
        expect(await main(["run", ws])).toBe(1);
        expect(err).toContain(`run: warning, ${file} was ignored (it cannot be read, EACCES)`);
        expect(err).toContain(`next: fix ${file}, then docsxai run ${ws}`);
      } finally {
        await fs.chmod(file, 0o644);
      }
    },
  );

  it("a plugins entry of the wrong shape shows the two shapes that work", async () => {
    const ws = await workspace("--auth", "none");
    const file = path.join(ws, ".docsxai.json");
    const cfg = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...cfg, plugins: [{ name: "./plugins/a" }] }));
    expect(await main(["plugins", "list", ws])).toBe(1);
    expect(err).toContain("plugins.0");
    expect(err).toContain('{"package": "<name>"} or {"path": "<dir>"}');
  });
});
