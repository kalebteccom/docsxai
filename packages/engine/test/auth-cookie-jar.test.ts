import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CookieJar, fetchCollectingCookies, jarAuthExpiry, parseSetCookie } from "../src/auth.js";
import { startJsonLoginServer, type FixtureServer } from "./fixtures/auth-servers.js";

const REQUEST_URL = new URL("http://app.example.test/api/auth/login");
const NOW = 1_700_000_000_000;

describe("parseSetCookie", () => {
  it("defaults domain to the request host (host-only) and path to the request directory", () => {
    const c = parseSetCookie("sid=abc", REQUEST_URL, NOW)!;
    expect(c).toMatchObject({
      name: "sid",
      value: "abc",
      domain: "app.example.test",
      path: "/api/auth",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
  });

  it("parses Domain (leading-dot normalised), Path, HttpOnly, Secure, SameSite", () => {
    const c = parseSetCookie(
      "sid=abc; Domain=Example.Test; Path=/; HttpOnly; Secure; SameSite=Strict",
      REQUEST_URL,
      NOW,
    )!;
    expect(c).toMatchObject({
      domain: ".example.test",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
  });

  it("parses Expires into epoch seconds", () => {
    const c = parseSetCookie(
      "sid=abc; Expires=Wed, 15 Nov 2023 12:00:00 GMT; Path=/",
      REQUEST_URL,
      NOW,
    )!;
    expect(c.expires).toBe(Date.parse("Wed, 15 Nov 2023 12:00:00 GMT") / 1000);
  });

  it("Max-Age beats Expires", () => {
    const c = parseSetCookie(
      "sid=abc; Expires=Wed, 15 Nov 2023 12:00:00 GMT; Max-Age=60",
      REQUEST_URL,
      NOW,
    )!;
    expect(c.expires).toBe(Math.floor(NOW / 1000) + 60);
  });

  it("SameSite=None and unknown SameSite values map to None / Lax", () => {
    expect(parseSetCookie("a=1; SameSite=None", REQUEST_URL, NOW)!.sameSite).toBe("None");
    expect(parseSetCookie("a=1; SameSite=bogus", REQUEST_URL, NOW)!.sameSite).toBe("Lax");
  });

  it("returns null for headers without a name=value pair", () => {
    expect(parseSetCookie("no-equals-sign", REQUEST_URL, NOW)).toBeNull();
    expect(parseSetCookie("=value-only", REQUEST_URL, NOW)).toBeNull();
  });
});

describe("CookieJar", () => {
  it("replaces a cookie with the same name+domain+path and keeps distinct paths apart", () => {
    const jar = new CookieJar();
    jar.add(parseSetCookie("sid=old; Path=/", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("sid=new; Path=/", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("sid=scoped; Path=/api", REQUEST_URL, NOW)!, NOW);
    expect(jar.cookies()).toHaveLength(2);
    expect(
      jar
        .cookies()
        .map((c) => c.value)
        .sort(),
    ).toEqual(["new", "scoped"]);
  });

  it("a Max-Age=0 deletion removes the stored cookie", () => {
    const jar = new CookieJar();
    jar.add(parseSetCookie("sid=abc; Path=/", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("sid=; Path=/; Max-Age=0", REQUEST_URL, NOW)!, NOW);
    expect(jar.has("sid")).toBe(false);
  });

  it("cookieHeaderFor matches domain, path, and expiry", () => {
    const jar = new CookieJar();
    jar.add(parseSetCookie("host=1; Path=/", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("sub=1; Domain=example.test; Path=/", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("scoped=1; Path=/api", REQUEST_URL, NOW)!, NOW);
    jar.add(parseSetCookie("dead=1; Path=/; Max-Age=10", REQUEST_URL, NOW)!, NOW);

    const later = NOW + 60_000;
    expect(jar.cookieHeaderFor(new URL("http://app.example.test/api/x"), later)).toBe(
      "host=1; sub=1; scoped=1",
    );
    expect(jar.cookieHeaderFor(new URL("http://app.example.test/other"), later)).toBe(
      "host=1; sub=1",
    );
    expect(jar.cookieHeaderFor(new URL("http://deep.example.test/"), later)).toBe("sub=1");
    expect(jar.cookieHeaderFor(new URL("http://unrelated.test/"), later)).toBe("");
  });

  it("withholds Secure cookies from http origins except loopback", () => {
    const jar = new CookieJar();
    jar.add(parseSetCookie("s=1; Path=/; Secure", REQUEST_URL, NOW)!, NOW);
    expect(jar.cookieHeaderFor(new URL("http://app.example.test/"), NOW)).toBe("");
    expect(jar.cookieHeaderFor(new URL("https://app.example.test/"), NOW)).toBe("s=1");
    const loopJar = new CookieJar();
    loopJar.add(parseSetCookie("s=1; Path=/; Secure", new URL("http://127.0.0.1/"), NOW)!, NOW);
    expect(loopJar.cookieHeaderFor(new URL("http://127.0.0.1/"), NOW)).toBe("s=1");
  });

  it("toStorageState wraps the jar in the storageState shape with no origins", () => {
    const jar = new CookieJar();
    jar.add(parseSetCookie("sid=abc; Path=/", REQUEST_URL, NOW)!, NOW);
    expect(jar.toStorageState()).toEqual({ cookies: jar.cookies(), origins: [] });
  });
});

describe("jarAuthExpiry", () => {
  const cookie = (name: string, expires: number) => ({
    name,
    value: "v",
    domain: "x",
    path: "/",
    expires,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  });

  it("prefers the named cookie's expiry", () => {
    const state = { cookies: [cookie("a", 100), cookie("sid", 200)], origins: [] };
    expect(jarAuthExpiry(state, "sid")).toBe(200_000);
    expect(jarAuthExpiry(state, "missing")).toBeUndefined();
  });

  it("without a name: only an unambiguous single real-expiry cookie counts", () => {
    expect(jarAuthExpiry({ cookies: [cookie("a", 100)], origins: [] })).toBe(100_000);
    expect(
      jarAuthExpiry({ cookies: [cookie("a", 100), cookie("b", 200)], origins: [] }),
    ).toBeUndefined();
    expect(jarAuthExpiry({ cookies: [cookie("a", -1)], origins: [] })).toBeUndefined();
  });
});

describe("fetchCollectingCookies (against the JSON login fixture)", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startJsonLoginServer();
  });
  afterAll(() => server.close());

  it("collects Set-Cookie across the redirect chain and replays the jar on each hop", async () => {
    const r = await fetchCollectingCookies(`${server.url}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "fixture-pass" }),
    });
    expect(r.status).toBe(200);
    expect(r.hops).toBe(2);
    expect(r.url).toBe(`${server.url}/session`);
    // `pre` was set on hop 0 and required by /issue on hop 1 — proves jar replay between hops.
    expect(r.jar.has("pre")).toBe(true);
    expect(r.jar.has("sid")).toBe(true);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true });
  });

  it("throws after maxRedirects hops on a redirect loop", async () => {
    await expect(
      fetchCollectingCookies(`${server.url}/loop`, {}, { maxRedirects: 5 }),
    ).rejects.toThrow(/exceeded 5 hops/);
  });

  it("does not follow redirects past the cap even when lower than default", async () => {
    await expect(
      fetchCollectingCookies(`${server.url}/loop`, {}, { maxRedirects: 1 }),
    ).rejects.toThrow(/exceeded 1 hops/);
  });
});
