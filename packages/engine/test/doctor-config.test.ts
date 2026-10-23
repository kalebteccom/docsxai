// `docsxai doctor` config probes: field validity, burn.theme shape, write access, the app_url HEAD
// and backend login state. Each check takes injected inputs, so no network or browser is touched.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAppUrl,
  checkConfigFields,
  checkLogin,
  checkWritable,
} from "../src/doctor-checks-config.js";
import { buildDoctorChecks, formatDoctorChecks } from "../src/doctor.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-cfg-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const errWithCode = (code: string, name = "TypeError"): Error => {
  const cause = Object.assign(new Error(code), { code });
  return Object.assign(new TypeError("fetch failed", { cause }), { name });
};

describe("checkConfigFields", () => {
  it("passes a minimal config and prints nothing for a null config", () => {
    expect(checkConfigFields(null)).toEqual([]);
    const [c, ...rest] = checkConfigFields({ app_url: "https://app.example.com" });
    expect(c).toMatchObject({ name: "config", ok: true });
    expect(rest).toEqual([]);
  });

  it("fails on a bad app_url, backend_url and ignore_https_errors, listing each", () => {
    const [c] = checkConfigFields({
      app_url: "ftp://x",
      backend_url: "not a url",
      ignore_https_errors: "yes",
    });
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("app_url must start with http");
    expect(c?.detail).toContain("backend_url is not a valid URL");
    expect(c?.detail).toContain("ignore_https_errors must be true or false");
    expect(c?.fix).toContain(".docsxai.json");
  });

  it("checks the burn.theme shape and the preset name", () => {
    const bad = checkConfigFields({ burn: { theme: { preset: "loud" }, extra: 1 } });
    expect(bad[0]?.ok).toBe(false);
    expect(bad[0]?.detail).toContain('burn.theme.preset "loud"');
    expect(bad[0]?.detail).toContain("burn.extra is not a known key");
    expect(checkConfigFields({ burn: { theme: "soft" } })[0]?.detail).toContain(
      "burn.theme must be an object",
    );
  });

  it("notes that the viewer owns theme values and contrast when the block is well-formed", () => {
    const checks = checkConfigFields({
      burn: { theme: { preset: "readable", accent: "#0b6e4f" } },
    });
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ["config", true],
      ["theme", true],
    ]);
    expect(checks[1]?.detail).toMatch(/checked by the viewer/);
    expect(checks[1]?.fix).toContain("docsxai burn");
  });
});

describe("checkWritable", () => {
  it("passes for a writable workspace and ignores absent output dirs", async () => {
    const c = await checkWritable(tmp);
    expect(c).toMatchObject({ name: "writable", ok: true });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "fails naming the read-only output dir and the chmod to run",
    async () => {
      const docs = path.join(tmp, "docs");
      await fs.mkdir(docs);
      await fs.chmod(docs, 0o555);
      try {
        const c = await checkWritable(tmp);
        expect(c.ok).toBe(false);
        expect(c.detail).toContain(docs);
        expect(c.fix).toMatch(/^chmod u\+w /);
      } finally {
        await fs.chmod(docs, 0o755);
      }
    },
  );
});

describe("checkAppUrl", () => {
  const cfg = { app_url: "https://app.example.com/" };
  const answer = (status: number): typeof fetch =>
    (async () => new Response(null, { status })) as never;
  const reject = (e: Error): typeof fetch => (async () => Promise.reject(e)) as never;

  it("returns null when no usable app_url is configured", async () => {
    expect(await checkAppUrl(null, answer(200), false)).toBeNull();
    expect(await checkAppUrl({}, answer(200), false)).toBeNull();
    expect(await checkAppUrl({ app_url: "nope" }, answer(200), false)).toBeNull();
  });

  it("sends a HEAD with a short timeout and counts any HTTP answer as reachable", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 405 });
    }) as typeof fetch;
    const c = await checkAppUrl(cfg, spy, false);
    expect(c).toMatchObject({ name: "app_url", ok: true });
    expect(c?.detail).toContain("HTTP 405");
    expect(seen?.method).toBe("HEAD");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("is skipped with a clear line under --offline and never calls fetch", async () => {
    const never = (async () => {
      throw new Error("must not be called");
    }) as typeof fetch;
    const c = await checkAppUrl(cfg, never, true);
    expect(c).toMatchObject({ ok: true, info: true });
    expect(c?.detail).toContain("--offline");
  });

  it("is skipped, not failed, when a remote host cannot be resolved", async () => {
    const c = await checkAppUrl(cfg, reject(errWithCode("ENOTFOUND")), false);
    expect(c).toMatchObject({ ok: true, info: true });
    expect(c?.detail).toMatch(/looks offline/);
  });

  it("fails when a local app refuses the connection", async () => {
    const c = await checkAppUrl(
      { app_url: "http://localhost:5173" },
      reject(errWithCode("ECONNREFUSED")),
      false,
    );
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("ECONNREFUSED");
    expect(c?.fix).toContain("start the app");
  });

  it("fails on a local ENOTFOUND, which is not an offline signal", async () => {
    const c = await checkAppUrl(
      { app_url: "http://app.localhost:3000" },
      reject(errWithCode("ENOTFOUND")),
      false,
    );
    expect(c?.ok).toBe(false);
  });

  it("fails on a timeout", async () => {
    const c = await checkAppUrl(cfg, reject(errWithCode("ETIMEDOUT", "TimeoutError")), false);
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("did not answer within 3s");
  });

  it("asks for ignore_https_errors on a certificate error unless it is set", async () => {
    const tls = errWithCode("DEPTH_ZERO_SELF_SIGNED_CERT");
    const bad = await checkAppUrl(cfg, reject(tls), false);
    expect(bad?.ok).toBe(false);
    expect(bad?.fix).toContain("ignore_https_errors");
    const okay = await checkAppUrl({ ...cfg, ignore_https_errors: true }, reject(tls), false);
    expect(okay?.ok).toBe(true);
  });

  it("prints the URL without credentials or query", async () => {
    const c = await checkAppUrl(
      { app_url: "https://user:pw@app.example.com/?t=1" },
      answer(200),
      false,
    );
    expect(c?.detail).not.toContain("pw");
    expect(c?.detail).not.toContain("t=1");
  });
});

describe("checkLogin", () => {
  it("is informational without backend_url", () => {
    expect(checkLogin(tmp, {}, {})).toMatchObject({ ok: true, info: true });
  });

  it("passes with DOCSX_TOKEN or stored OAuth tokens", async () => {
    const cfg = { backend_url: "http://localhost:4477" };
    expect(checkLogin(tmp, cfg, { DOCSX_TOKEN: "t" })).toMatchObject({ ok: true });
    await fs.mkdir(path.join(tmp, ".auth"));
    await fs.writeFile(path.join(tmp, ".auth", "backend-token.json"), "{}", "utf8");
    expect(checkLogin(tmp, cfg, {}).detail).toContain("backend-token.json");
  });

  it("fails with the login command when a backend is set and no token exists", () => {
    const c = checkLogin(tmp, { backend_url: "http://localhost:4477" }, {});
    expect(c.ok).toBe(false);
    expect(c.fix).toContain("docsxai login --backend-url http://localhost:4477 --oauth");
  });
});

describe("doctor assembly with the config probes", () => {
  it("runs the probes inside a workspace, honours offline, and is stable across runs", async () => {
    await fs.mkdir(path.join(tmp, "flows"));
    await fs.writeFile(
      path.join(tmp, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        app_url: "https://app.example.com",
        burn: { theme: { preset: "soft" } },
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    const opts = {
      workspaceDir: tmp,
      nodeVersion: "26.0.0",
      chromiumProbe: async () => ({ ok: true, detail: "/fake/chromium" }),
      env: { PATH: "" },
      offline: true,
    };
    const checks = await buildDoctorChecks(opts);
    const names = checks.map((c) => c.name);
    for (const n of ["config", "theme", "writable", "app_url", "login"]) expect(names).toContain(n);
    const text = formatDoctorChecks(checks);
    expect(text).toMatch(/^ok: app_url: https:\/\/app\.example\.com\/? not probed \(--offline\)/m);
    expect(formatDoctorChecks(await buildDoctorChecks(opts))).toBe(text);
  });
});
