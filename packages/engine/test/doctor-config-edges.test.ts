// `docsxai doctor` config probes, the edges: what counts as an answer from app_url, error chains,
// config values of the wrong type, unwritable dirs, and URLs that carry credentials. Inputs are
// injected, so nothing here touches the network.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBackend } from "../src/doctor-checks.js";
import {
  checkAppUrl,
  checkConfigFields,
  checkLogin,
  checkWritable,
} from "../src/doctor-checks-config.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-edges-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const PASSWORD = "s3cr3t-value";
const withCredentials = (base: string): string => {
  const url = new URL(base);
  url.username = "user";
  url.password = PASSWORD;
  return url.href;
};
/** An error `wraps` causes deep: the innermost carries `code`, the outer ones say "fetch failed". */
const failure = (code: string | undefined, wraps: number): Error => {
  let err: Error = Object.assign(new Error("inner"), code ? { code } : {});
  for (let i = 0; i < wraps; i++) err = new TypeError("fetch failed", { cause: err });
  return err;
};
const reject =
  (e: unknown): typeof fetch =>
  async () => {
    throw e;
  };
const answer =
  (status: number): typeof fetch =>
  async () =>
    new Response(null, { status });
const asText = (input: unknown): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : "";
const never = (async () => {
  throw new Error("fetch must not be called");
}) as typeof fetch;
const REMOTE = { app_url: "https://app.example.com/" };

describe("checkAppUrl: what counts as an answer", () => {
  it.each([[301], [401], [503]])(
    "counts HTTP %i as reachable, not as a failure",
    async (status) => {
      const c = await checkAppUrl(REMOTE, answer(status), false);
      expect(c).toMatchObject({ name: "app_url", ok: true });
      expect(c?.info).toBeUndefined();
      expect(c?.detail).toContain(`answered HTTP ${status}`);
    },
  );

  it("does not follow a redirect, so an http app that sends visitors to https is reachable", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status: 301, headers: { location: "https://app.example.com/" } });
    }) as typeof fetch;
    const c = await checkAppUrl({ app_url: "http://app.example.com/" }, spy, false);
    expect(seen?.redirect).toBe("manual");
    expect(c).toMatchObject({ ok: true });
    expect(c?.detail).toContain("http://app.example.com answered HTTP 301");
  });

  it.each([[5], ["javascript:alert(1)"]])(
    "returns null and sends nothing for app_url %j",
    async (app_url) => {
      expect(await checkAppUrl({ app_url }, never, false)).toBeNull();
    },
  );
});

describe("checkAppUrl: offline and loopback", () => {
  it("skips a remote host on EAI_AGAIN, naming the code", async () => {
    const c = await checkAppUrl(REMOTE, reject(failure("EAI_AGAIN", 1)), false);
    expect(c).toMatchObject({ ok: true, info: true });
    expect(c?.detail).toContain("looks offline (EAI_AGAIN)");
  });

  it.each([
    ["http://localhost:5173", "EAI_AGAIN"],
    ["http://127.0.0.1:3000", "EHOSTUNREACH"],
    ["http://[::1]:3000", "ENETUNREACH"],
    ["http://app.localhost:3000", "ENETDOWN"],
  ])("fails a loopback app_url %s on %s", async (app_url, code) => {
    const c = await checkAppUrl({ app_url }, reject(failure(code, 1)), false);
    expect(c?.ok).toBe(false);
    expect(c?.info).toBeUndefined();
    expect(c?.detail).toContain(`unreachable (${code})`);
  });

  it("reads the code from an error three causes deep and not from four", async () => {
    const found = await checkAppUrl(REMOTE, reject(failure("ENOTFOUND", 3)), false);
    expect(found?.detail).toContain("looks offline (ENOTFOUND)");
    const lost = await checkAppUrl(REMOTE, reject(failure("ENOTFOUND", 4)), false);
    expect(lost?.ok).toBe(false);
    expect(lost?.detail).toContain("unreachable (fetch failed)");
  });

  it("falls back to the error message when there is no code", async () => {
    const c = await checkAppUrl(REMOTE, reject(failure(undefined, 0)), false);
    expect(c?.detail).toContain("unreachable (inner)");
  });
});

describe("checkAppUrl: timeouts and certificates", () => {
  it("reports a DOMException TimeoutError, as AbortSignal.timeout produces, as a timeout", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const c = await checkAppUrl(REMOTE, reject(timeout), false);
    expect(c?.ok).toBe(false);
    expect(c?.detail).toContain("did not answer within 3s");
  });

  it("reports an AbortError as unreachable, with its message", async () => {
    const abort = new DOMException("This operation was aborted", "AbortError");
    const c = await checkAppUrl(REMOTE, reject(abort), false);
    expect(c?.detail).toContain("unreachable (This operation was aborted)");
  });

  it.each([
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ["CERT_HAS_EXPIRED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID"],
    ["SELF_SIGNED_CERT_IN_CHAIN"],
  ])("treats %s as a certificate problem", async (code) => {
    const c = await checkAppUrl(REMOTE, reject(failure(code, 1)), false);
    expect(c).toMatchObject({ ok: false });
    expect(c?.detail).toContain(`certificate rejected (${code})`);
    expect(c?.fix).toContain("ignore_https_errors");
  });

  it("accepts the certificate error only for ignore_https_errors set to true", async () => {
    const tls = reject(failure("CERT_HAS_EXPIRED", 1));
    for (const value of ["true", 1, false, null]) {
      const c = await checkAppUrl({ ...REMOTE, ignore_https_errors: value }, tls, false);
      expect(c?.ok).toBe(false);
    }
    const set = await checkAppUrl({ ...REMOTE, ignore_https_errors: true }, tls, false);
    expect(set).toMatchObject({ ok: true });
    expect(set?.detail).toContain("ignore_https_errors is set");
  });
});

describe("checkAppUrl: credentials in the URL", () => {
  const url = withCredentials("https://app.example.com/?token=abc");
  const mimic: typeof fetch = async (input) => {
    throw new TypeError(
      `Request cannot be constructed from a URL that includes credentials: ${asText(input)}`,
    );
  };

  it("never prints the password or the query, whatever the outcome", async () => {
    const outcomes = [
      await checkAppUrl({ app_url: url }, answer(200), false),
      await checkAppUrl({ app_url: url }, never, true),
      await checkAppUrl({ app_url: url }, mimic, false),
      await checkAppUrl({ app_url: url }, reject(failure("ECONNREFUSED", 1)), false),
      await checkAppUrl({ app_url: url }, reject(failure("CERT_HAS_EXPIRED", 1)), false),
      await checkAppUrl({ app_url: url }, reject(failure("ENOTFOUND", 1)), false),
      await checkAppUrl({ app_url: url }, reject(new DOMException("t", "TimeoutError")), false),
    ];
    for (const c of outcomes) {
      expect(c).not.toBeNull();
      expect(`${c?.detail} ${c?.fix ?? ""}`).not.toContain(PASSWORD);
      expect(`${c?.detail} ${c?.fix ?? ""}`).not.toContain("token=abc");
    }
  });

  it("keeps the host in the line when it strips the credentials from an error message", async () => {
    const c = await checkAppUrl({ app_url: url }, mimic, false);
    expect(c?.detail).toContain("https://app.example.com unreachable (Request cannot be");
    expect(c?.detail).toContain("credentials: https://app.example.com)");
  });
});

describe("checkConfigFields: values of the wrong type", () => {
  const detailOf = (config: Record<string, unknown>): string => {
    const [c] = checkConfigFields(config);
    expect(c).toMatchObject({ name: "config", ok: false });
    return c!.detail;
  };

  it.each([
    [{ app_url: 5 }, "app_url must be a string"],
    [{ backend_url: "mailto:a@b.c" }, "backend_url must start with http:// or https://"],
    [{ burn: null }, "burn must be an object holding a theme block"],
    [{ burn: [] }, "burn must be an object holding a theme block"],
    [{ burn: "soft" }, "burn must be an object holding a theme block"],
    [{ burn: { theme: null } }, "burn.theme must be an object"],
    [{ burn: { theme: [] } }, "burn.theme must be an object"],
    [{ burn: { theme: { preset: 5 } } }, 'burn.theme.preset "5" is not one of'],
    [{ burn: { theme: { preset: "Soft" } } }, 'burn.theme.preset "Soft" is not one of'],
  ])("fails %j with %s", (config, message) => {
    expect(detailOf(config)).toContain(message);
  });

  it("prefixes the file name and lists every problem in key order, joined by semicolons", () => {
    const detail = detailOf({
      app_url: 5,
      backend_url: 6,
      burn: { extra: 1, theme: 7 },
    });
    expect(detail).toBe(
      ".docsxai.json: app_url must be a string; backend_url must be a string; " +
        "burn.extra is not a known key (the only key is theme); burn.theme must be an object",
    );
  });

  it("adds the informational theme line for an empty burn block, and none when burn is absent", () => {
    expect(checkConfigFields({ burn: {} }).map((c) => c.name)).toEqual(["config", "theme"]);
    expect(checkConfigFields({ app_url: "https://app.example.com" }).map((c) => c.name)).toEqual([
      "config",
    ]);
  });

  it("adds no theme line when the config already failed", () => {
    expect(checkConfigFields({ app_url: 5, burn: { theme: {} } }).map((c) => c.name)).toEqual([
      "config",
    ]);
  });
});

describe("checkWritable: edges", () => {
  it("fails a workspace root that does not exist, and quotes a path with a space", async () => {
    const missing = path.join(tmp, "no such dir");
    const c = await checkWritable(missing);
    expect(c.ok).toBe(false);
    expect(c.detail).toBe(`no write access to ${path.resolve(missing)}`);
    expect(c.fix).toBe(`chmod u+w '${path.resolve(missing)}', or use another workspace dir`);
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "lists the root and a read-only output dir together, root first",
    async () => {
      const flows = path.join(tmp, "flows");
      await fs.mkdir(flows);
      await fs.chmod(flows, 0o555);
      await fs.chmod(tmp, 0o555);
      try {
        const c = await checkWritable(tmp);
        expect(c.ok).toBe(false);
        expect(c.detail).toBe(`no write access to ${path.resolve(tmp)}, ${flows}`);
      } finally {
        await fs.chmod(tmp, 0o755);
        await fs.chmod(flows, 0o755);
      }
    },
  );
});

describe("checkLogin: edges", () => {
  const backend = { backend_url: "https://api.example.com" };

  it("is informational for a backend_url that is empty or not a string", () => {
    expect(checkLogin(tmp, { backend_url: "" }, {})).toMatchObject({ ok: true, info: true });
    expect(checkLogin(tmp, { backend_url: 5 }, {})).toMatchObject({ ok: true, info: true });
    expect(checkLogin(tmp, null, {})).toMatchObject({ ok: true, info: true });
  });

  it("treats an empty DOCSX_TOKEN as no token", () => {
    const c = checkLogin(tmp, backend, { DOCSX_TOKEN: "" });
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("not logged in to https://api.example.com");
  });

  it("leaves the password and query of backend_url out of the line and the command", () => {
    const c = checkLogin(tmp, { backend_url: withCredentials("https://api.example.com/?k=v") }, {});
    const text = `${c.detail} ${c.fix}`;
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("k=v");
    expect(c.fix).toContain("--backend-url https://api.example.com --oauth");
  });
});

describe("checkBackend: credentials in backend_url", () => {
  const url = withCredentials("https://api.example.com/");
  const config = { backend_url: url };

  it("prints the host without the password on success and on an unhealthy answer", async () => {
    const ok = await checkBackend(tmp, config, {}, answer(200));
    expect(ok.detail).toContain("https://api.example.com/v1/health ok");
    const sick = await checkBackend(tmp, config, {}, answer(503));
    expect(sick.detail).toBe("https://api.example.com/v1/health → HTTP 503");
    expect(`${ok.detail} ${sick.detail}`).not.toContain(PASSWORD);
  });

  it("strips the URL a fetch error quotes", async () => {
    const quoting: typeof fetch = async (input) => {
      throw new TypeError(
        `Request cannot be constructed from a URL that includes credentials: ${asText(input)}`,
      );
    };
    const c = await checkBackend(tmp, config, {}, quoting);
    expect(c.ok).toBe(false);
    expect(c.detail).not.toContain(PASSWORD);
    expect(c.detail).toContain("https://api.example.com/v1/health unreachable");
  });
});
