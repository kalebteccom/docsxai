// The request guard: which URLs `requestProblem` refuses, how `installEgressGuard` turns that into
// an abort on every request of a context, and how the environment switches are read. No browser
// starts. Redirects are modelled the way Chromium reports them: each hop is a new request that
// goes through the route handler again. The hops run against an in-process HTTP server on
// loopback; a resolver the test injects maps names to addresses, so no DNS is touched.

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  egressContextOptions,
  egressGuardFromEnv,
  envFlagOff,
  envFlagOn,
  installEgressGuard,
  requestProblem,
  resolveEgressGuard,
  type EgressGuardOptions,
  type GuardableContext,
  type GuardRoute,
  type GuardWebSocket,
  type HostLookup,
} from "../src/egress-guard.js";

const NAMES: Record<string, string[]> = {
  "app.test": ["127.0.0.1"],
  localhost: ["127.0.0.1", "::1"],
  "localhost.localdomain": ["127.0.0.1"],
  "metadata.test": ["169.254.169.254"],
  "public.test": ["93.184.216.34"],
  "mixed.test": ["93.184.216.34", "169.254.169.254"],
  "mapped.test": ["::ffff:169.254.169.254"],
  "linklocal.test": ["fe80::1%eth0"],
  "6to4.test": ["2002:a9fe:a9fe::1"],
  "169.254.169.254.nip.io": ["169.254.169.254"],
  "empty.test": [],
};

const lookup: HostLookup = (hostname) => {
  const answer = NAMES[hostname];
  return answer
    ? Promise.resolve(answer)
    : Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`));
};

describe("envFlagOn and envFlagOff", () => {
  it.each(["1", "true", "TRUE", "True", "yes", "Yes", " 1 "])("%j is on", (v) => {
    expect(envFlagOn(v)).toBe(true);
    expect(envFlagOff(v)).toBe(false);
  });

  it.each(["0", "false", "False", "no", "NO"])("%j is off on purpose", (v) => {
    expect(envFlagOn(v)).toBe(false);
    expect(envFlagOff(v)).toBe(true);
  });

  it.each(["", "2", "on", "y", "tru", "1 1", undefined])("%j is neither", (v) => {
    expect(envFlagOn(v)).toBe(false);
    expect(envFlagOff(v)).toBe(false);
  });
});

describe("egressGuardFromEnv", () => {
  it("is off unless DOCSX_EGRESS_GUARD says on", () => {
    expect(egressGuardFromEnv({})).toBeUndefined();
    expect(egressGuardFromEnv({ DOCSX_EGRESS_GUARD: "0" })).toBeUndefined();
    expect(egressGuardFromEnv({ DOCSX_EGRESS_GUARD: "enabled" })).toBeUndefined();
    expect(egressGuardFromEnv({ DOCSX_EGRESS_DENY_PRIVATE: "1" })).toBeUndefined();
  });

  it("reads DOCSX_EGRESS_DENY_PRIVATE as 1, true or yes", () => {
    expect(egressGuardFromEnv({ DOCSX_EGRESS_GUARD: "1" })).toEqual({ denyPrivate: false });
    expect(egressGuardFromEnv({ DOCSX_EGRESS_GUARD: "Yes" })).toEqual({ denyPrivate: false });
    for (const v of ["1", "true", "YES"]) {
      const env = { DOCSX_EGRESS_GUARD: "true", DOCSX_EGRESS_DENY_PRIVATE: v };
      expect(egressGuardFromEnv(env)).toEqual({ denyPrivate: true });
    }
    const off = { DOCSX_EGRESS_GUARD: "1", DOCSX_EGRESS_DENY_PRIVATE: "no" };
    expect(egressGuardFromEnv(off)).toEqual({ denyPrivate: false });
  });

  it("lets an explicit option win over the environment", () => {
    const explicit: EgressGuardOptions = { denyPrivate: true };
    expect(resolveEgressGuard(explicit, {})).toBe(explicit);
    expect(resolveEgressGuard(undefined, { DOCSX_EGRESS_GUARD: "1" })).toEqual({
      denyPrivate: false,
    });
    expect(resolveEgressGuard(undefined, {})).toBeUndefined();
  });

  it("blocks service workers on a guarded context only", () => {
    expect(egressContextOptions({})).toEqual({ serviceWorkers: "block" });
    expect(egressContextOptions(undefined)).toEqual({});
  });
});

describe("requestProblem", () => {
  const noLookup: HostLookup = () => {
    throw new Error("a literal address must not be resolved");
  };

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254",
    "http://2852039166/",
    "http://0xa9.0xfe.0xa9.0xfe/",
    "http://[fd00:ec2::254]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[2002:a9fe:a9fe::1]/",
    "http://[2001:0:4136:e378:8000:63bf:5601:5601]/",
    "http://168.63.129.16/machine",
    "http://100.100.100.200/",
    "http://metadata.google.internal/",
    "http://instance-data./",
    "ws://169.254.169.254/socket",
    "wss://[fe80::1]/",
  ])("refuses the literal or metadata name %s without a lookup", async (url) => {
    expect(await requestProblem(url, { lookup: noLookup })).toMatch(/link-local or cloud-metadata/);
  });

  it("refuses a name that resolves to a metadata address", async () => {
    for (const host of ["metadata.test", "169.254.169.254.nip.io"]) {
      expect(await requestProblem(`http://${host}/x`, { lookup })).toBe(
        `${host} resolves to 169.254.169.254, a link-local or cloud-metadata address`,
      );
    }
  });

  it("refuses a name when any one of its answers is a metadata address", async () => {
    expect(await requestProblem("https://mixed.test/", { lookup })).toMatch(
      /mixed\.test resolves to 169\.254\.169\.254/,
    );
  });

  it.each(["mapped.test", "linklocal.test", "6to4.test"])(
    "refuses %s whose answer is an IPv6 form of a refused address",
    async (host) => {
      expect(await requestProblem(`http://${host}/`, { lookup })).toMatch(
        /resolves to .*link-local or cloud-metadata/,
      );
    },
  );

  it("allows a name that resolves to a public address", async () => {
    expect(await requestProblem("https://public.test/a?b=c#d", { lookup })).toBeNull();
  });

  it("looks a name up without its trailing dot", async () => {
    const seen: string[] = [];
    const spy: HostLookup = (h) => {
      seen.push(h);
      return Promise.resolve(["93.184.216.34"]);
    };
    expect(await requestProblem("http://public.test./", { lookup: spy })).toBeNull();
    expect(seen).toEqual(["public.test"]);
  });

  it("fails closed when the lookup rejects, throws or returns nothing", async () => {
    expect(await requestProblem("http://unknown.test/", { lookup })).toMatch(
      /unknown\.test did not resolve \(getaddrinfo ENOTFOUND unknown\.test\), refused/,
    );
    expect(await requestProblem("http://empty.test/", { lookup })).toBe(
      "empty.test resolved to no address, refused",
    );
    const throwing: HostLookup = () => {
      throw new Error("resolver crashed");
    };
    expect(await requestProblem("http://public.test/", { lookup: throwing })).toMatch(
      /did not resolve \(resolver crashed\), refused/,
    );
  });

  it("refuses a URL that does not parse and a scheme that is neither network nor inert", async () => {
    expect(await requestProblem("not a url", { lookup })).toMatch(/does not parse/);
    for (const url of ["file:///etc/passwd", "ftp://public.test/", "chrome://version"]) {
      expect(await requestProblem(url, { lookup })).toMatch(/scheme is not allowed/);
    }
  });

  it("lets data:, blob: and about: through, which never reach the network", async () => {
    for (const url of ["data:text/html,hi", "blob:https://public.test/uuid", "about:blank"]) {
      expect(await requestProblem(url, { lookup: noLookup })).toBeNull();
    }
  });

  it("allows loopback and private addresses by default and refuses them under denyPrivate", async () => {
    const urls = [
      "http://127.0.0.1:3000/",
      "http://localhost:3000/",
      "http://localhost.localdomain/",
      "http://10.1.2.3/",
      "http://192.168.0.1/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fec0::1]/",
      "http://[64:ff9b:1::1]/",
      "http://app.test/",
    ];
    for (const url of urls) {
      expect(await requestProblem(url, { lookup })).toBeNull();
      expect(await requestProblem(url, { lookup, denyPrivate: true })).toMatch(
        /loopback or private-network/,
      );
    }
  });

  it("still allows public addresses under denyPrivate", async () => {
    for (const url of ["http://8.8.8.8/", "https://public.test/", "http://[2002:808:808::1]/"]) {
      expect(await requestProblem(url, { lookup, denyPrivate: true })).toBeNull();
    }
  });
});

/** The slice of a browser the guard sees: one handler for every request, and a way to fire it. */
function fakeContext() {
  let handler: ((route: GuardRoute) => Promise<void>) | undefined;
  let socketHandler: ((ws: GuardWebSocket) => Promise<void>) | undefined;
  const patterns: RegExp[] = [];
  const context: GuardableContext = {
    route: (pattern, h) => {
      patterns.push(pattern);
      handler = h;
      return Promise.resolve();
    },
    routeWebSocket: (_pattern, h) => {
      socketHandler = h;
      return Promise.resolve();
    },
  };
  /** Open one WebSocket; resolves to what the handler did with it. */
  const socket = async (url: string): Promise<string> => {
    if (!socketHandler) throw new Error("no WebSocket route installed");
    let outcome = "unanswered";
    await socketHandler({
      url: () => url,
      close: () => {
        outcome = "close";
        return Promise.resolve();
      },
      connectToServer: () => {
        outcome = "connect";
      },
    });
    return outcome;
  };
  /** Fire one request; resolves to what the handler did with it. */
  const request = async (url: string): Promise<string> => {
    if (!handler) throw new Error("no route installed");
    let outcome = "unanswered";
    await handler({
      request: () => ({ url: () => url }),
      abort: (code) => {
        outcome = `abort:${code}`;
        return Promise.resolve();
      },
      continue: () => {
        outcome = "continue";
        return Promise.resolve();
      },
    });
    return outcome;
  };
  return { context, request, socket, patterns, installed: () => handler !== undefined };
}

describe("installEgressGuard", () => {
  it("installs nothing without a guard", async () => {
    const fake = fakeContext();
    await installEgressGuard(fake.context, undefined);
    expect(fake.installed()).toBe(false);
  });

  it("routes every URL, whatever its scheme", async () => {
    const fake = fakeContext();
    await installEgressGuard(fake.context, { lookup });
    expect(fake.patterns).toHaveLength(1);
    for (const url of ["http://a.test/x", "data:text/plain,x", "about:blank", "file:///x"]) {
      expect(fake.patterns[0]!.test(url)).toBe(true);
    }
  });

  it("continues an allowed request and aborts a refused one with blockedbyclient", async () => {
    const fake = fakeContext();
    await installEgressGuard(fake.context, { lookup, onBlock: () => {} });
    expect(await fake.request("https://public.test/")).toBe("continue");
    expect(await fake.request("http://metadata.test/latest")).toBe("abort:blockedbyclient");
    expect(await fake.request("http://169.254.169.254/")).toBe("abort:blockedbyclient");
  });

  it("aborts, rather than continuing, when the lookup fails", async () => {
    const fake = fakeContext();
    const blocked: string[] = [];
    await installEgressGuard(fake.context, {
      lookup,
      onBlock: (_u, reason, detail) => blocked.push(`${reason} | ${detail}`),
    });
    expect(await fake.request("http://unknown.test/")).toBe("abort:blockedbyclient");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/^address not allowed \| .*did not resolve.*refused/);
  });

  it("reports a refused URL without its userinfo, query string or fragment", async () => {
    const fake = fakeContext();
    const blocked: string[] = [];
    await installEgressGuard(fake.context, { lookup, onBlock: (url) => blocked.push(url) });
    await fake.request("http://user:pw@metadata.test/latest?token=secret#frag");
    expect(blocked).toEqual(["http://metadata.test/latest"]);
  });

  it("gives the generic reason, and keeps the host and address in the detail only", async () => {
    const fake = fakeContext();
    const seen: string[][] = [];
    await installEgressGuard(fake.context, {
      lookup,
      onBlock: (url, reason, detail) => seen.push([url, reason, detail]),
    });
    await fake.request("http://metadata.test/latest");
    expect(seen).toEqual([
      [
        "http://metadata.test/latest",
        "address not allowed",
        "metadata.test resolves to 169.254.169.254, a link-local or cloud-metadata address",
      ],
    ]);
  });

  describe("WebSockets", () => {
    it("closes one to a refused address and connects one to an allowed host", async () => {
      const fake = fakeContext();
      await installEgressGuard(fake.context, { lookup, onBlock: () => {} });
      expect(await fake.socket("wss://public.test/live")).toBe("connect");
      expect(await fake.socket("ws://metadata.test/live")).toBe("close");
      expect(await fake.socket("ws://169.254.169.254/live")).toBe("close");
      expect(await fake.socket("ws://unknown.test/live")).toBe("close");
    });

    it("applies denyPrivate to them too", async () => {
      const fake = fakeContext();
      await installEgressGuard(fake.context, { lookup, denyPrivate: true, onBlock: () => {} });
      expect(await fake.socket("ws://127.0.0.1:3000/")).toBe("close");
      expect(await fake.socket("ws://app.test/")).toBe("close");
    });
  });

  describe("on stderr", () => {
    afterEach(() => vi.restoreAllMocks());

    it("writes one line per refused request when no onBlock is given", async () => {
      const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const fake = fakeContext();
      await installEgressGuard(fake.context, { lookup });
      await fake.request("http://user:pw@metadata.test/latest?token=secret");
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0]![0]);
      expect(line).toBe("egress-guard: blocked http://metadata.test/latest: address not allowed\n");
      for (const hidden of ["secret", "pw", "169.254", "resolves"]) {
        expect(line).not.toContain(hidden);
      }
    });
  });
});

describe("a redirect hop to a refused address", () => {
  const hits: string[] = [];
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://metadata.test/latest/meta-data/?x=1" });
      } else if (req.url === "/to-nip") {
        res.writeHead(302, { location: "http://169.254.169.254.nip.io/latest/meta-data/" });
      } else if (req.url === "/to-final") {
        res.writeHead(302, { location: "/final" });
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
      }
      res.end("body");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** GET `url` from the fake server whatever its host name says; every name maps to the server. */
  const get = (url: string): Promise<{ status: number; location?: string }> =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      http
        .get(
          { host: "127.0.0.1", port, path: u.pathname + u.search, headers: { host: u.host } },
          (res) => {
            res.resume();
            res.on("end", () => {
              const location = res.headers.location;
              resolve({ status: res.statusCode ?? 0, ...(location ? { location } : {}) });
            });
          },
        )
        .on("error", reject);
    });

  /** Navigate the way Chromium does: a redirect is a new request, so it goes through the handler. */
  async function navigate(start: string, guard: EgressGuardOptions) {
    hits.length = 0;
    const fake = fakeContext();
    await installEgressGuard(fake.context, guard);
    const log: string[] = [];
    let url = start;
    for (let hop = 0; hop < 5; hop++) {
      const outcome = await fake.request(url);
      if (outcome !== "continue") {
        log.push(`${outcome} ${url}`);
        return log;
      }
      const res = await get(url);
      log.push(`${res.status} ${url}`);
      if (res.status < 300 || res.status >= 400 || !res.location) return log;
      url = new URL(res.location, url).href;
    }
    return log;
  }

  it("is aborted before it reaches the address the allowed host redirected to", async () => {
    const blocked: string[] = [];
    const log = await navigate(`http://app.test:${port}/to-metadata`, {
      lookup,
      onBlock: (url, reason, detail) => blocked.push(`${url} ${reason} | ${detail}`),
    });
    expect(log).toEqual([
      `302 http://app.test:${port}/to-metadata`,
      "abort:blockedbyclient http://metadata.test/latest/meta-data/?x=1",
    ]);
    expect(hits).toEqual(["/to-metadata"]);
    expect(blocked).toEqual([
      "http://metadata.test/latest/meta-data/ address not allowed | metadata.test resolves to 169.254.169.254, a link-local or cloud-metadata address",
    ]);
  });

  it("is aborted when the hop names the address through a wildcard DNS host", async () => {
    const log = await navigate(`http://app.test:${port}/to-nip`, { lookup, onBlock: () => {} });
    expect(log.at(-1)).toBe(
      "abort:blockedbyclient http://169.254.169.254.nip.io/latest/meta-data/",
    );
    expect(hits).toEqual(["/to-nip"]);
  });

  it("follows a redirect that stays on the allowed host", async () => {
    const log = await navigate(`http://app.test:${port}/to-final`, { lookup });
    expect(log).toEqual([
      `302 http://app.test:${port}/to-final`,
      `200 http://app.test:${port}/final`,
    ]);
    expect(hits).toEqual(["/to-final", "/final"]);
  });

  it("refuses the first request too under denyPrivate, as the server is on loopback", async () => {
    const log = await navigate(`http://app.test:${port}/to-final`, {
      lookup,
      denyPrivate: true,
      onBlock: () => {},
    });
    expect(log).toEqual([`abort:blockedbyclient http://app.test:${port}/to-final`]);
    expect(hits).toEqual([]);
  });

  it("sends nothing when the resolver fails", async () => {
    const failing: HostLookup = () => Promise.reject(new Error("SERVFAIL"));
    const log = await navigate(`http://app.test:${port}/to-final`, {
      lookup: failing,
      onBlock: () => {},
    });
    expect(log).toEqual([`abort:blockedbyclient http://app.test:${port}/to-final`]);
    expect(hits).toEqual([]);
  });
});
