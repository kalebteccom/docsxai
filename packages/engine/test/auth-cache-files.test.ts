// The local session cache keeps one file per role under .auth/. Two roles never share a file,
// no role lands on the OAuth token file, and the file is readable by its owner only.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalStorageStateCache,
  parseAuthStrategyFile,
  storageStateFileName,
  type StorageState,
} from "../src/auth.js";

let dir = "";
let cache: LocalStorageStateCache;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cache-files-"));
  cache = new LocalStorageStateCache(path.join(dir, ".auth"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const roleAuth = parseAuthStrategyFile(
  "schema: docsxai/auth-strategy@1\ndefault_role: editor\nroles: { editor: { strategy: manual-capture, cache: { enabled: true, store: local, ttl: 1h } } }",
).roles.editor!;

const stateFor = (value: string): StorageState => ({
  cookies: [
    {
      name: "session",
      value,
      domain: "app.example.test",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
  origins: [],
});

describe("session cache files", () => {
  it("roles a/b and a_b keep separate sessions", async () => {
    await cache.save("a/b", { storageState: stateFor("slash") }, roleAuth);
    await cache.save("a_b", { storageState: stateFor("underscore") }, roleAuth);
    expect((await cache.load("a/b"))?.cookies[0]?.value).toBe("slash");
    expect((await cache.load("a_b"))?.cookies[0]?.value).toBe("underscore");
  });

  it("keeps the plain name for a role that needs no escaping", () => {
    expect(storageStateFileName("editor")).toBe("editor.json");
    expect(storageStateFileName("a_b")).toBe("a_b.json");
  });

  it("a role cannot take the OAuth token file", async () => {
    expect(storageStateFileName("backend-token")).not.toBe("backend-token.json");
    await fs.mkdir(path.join(dir, ".auth"), { recursive: true });
    await fs.writeFile(path.join(dir, ".auth", "backend-token.json"), "{}", "utf8");
    await cache.save("backend-token", { storageState: stateFor("x") }, roleAuth);
    expect(await fs.readFile(path.join(dir, ".auth", "backend-token.json"), "utf8")).toBe("{}");
  });

  it.skipIf(process.platform === "win32")(
    "is written for the owner only, also over an older file",
    async () => {
      const file = path.join(dir, ".auth", "editor.json");
      await fs.mkdir(path.join(dir, ".auth"), { recursive: true });
      await fs.writeFile(file, "{}", { mode: 0o644 });
      await cache.save("editor", { storageState: stateFor("x") }, roleAuth);
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      await cache.save("other", { storageState: stateFor("y") }, roleAuth);
      expect((await fs.stat(path.join(dir, ".auth", "other.json"))).mode & 0o777).toBe(0o600);
    },
  );
});
