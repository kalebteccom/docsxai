// BackendStateCache ↔ real stub server: client-side-encrypted storage-state relay.

import { createBackendStub } from "@docsxai/backend";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BackendStateCache,
  BackendStateCacheError,
  type CachedStorageState,
} from "../src/backend-client.js";

const TOKEN = "test-token";
const CACHE_KEY = randomBytes(32).toString("base64");
const HOUR_MS = 3_600_000;

let base = "";
let wsId = "";
let stub: ReturnType<typeof createBackendStub>;

const SESSION_COOKIE_VALUE = "super-secret-session-value";

function fixtureState(overrides: Partial<CachedStorageState> = {}): CachedStorageState {
  return {
    cookies: [
      {
        name: "AppSession",
        value: SESSION_COOKIE_VALUE,
        domain: "app.example",
        path: "/",
        expires: Math.floor((Date.now() + 2 * HOUR_MS) / 1000),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: "https://app.example",
        localStorage: [{ name: "feature-flag", value: "on" }],
      },
    ],
    ...overrides,
  };
}

function makeCache(overrides: Partial<ConstructorParameters<typeof BackendStateCache>[0]> = {}) {
  return new BackendStateCache({
    baseUrl: base,
    token: TOKEN,
    workspaceId: wsId,
    cacheKey: CACHE_KEY,
    ...overrides,
  });
}

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
  const ws = (await (
    await fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "cache-ws" }),
    })
  ).json()) as { id: string };
  wsId = ws.id;
});
afterAll(async () => {
  await stub.close();
});

const envelopeUrl = (role: string) => `${base}/v1/workspaces/${wsId}/auth-cache/${role}`;
const authedHeaders = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("BackendStateCache", () => {
  it("round-trips save → load with the local-cache ttl semantics", async () => {
    const cache = makeCache();
    const state = fixtureState();
    const now = Date.now();

    const saved = await cache.save(
      "editor",
      { storageState: state },
      { cache: { ttl: "1h" } },
      now,
    );
    expect(saved).toEqual({ expiresAt: now + HOUR_MS, source: "ttl" });

    const loaded = await cache.load("editor", now + HOUR_MS - 1);
    expect(loaded).toEqual(state);
  });

  it("returns null past the computed expiry and for roles never saved", async () => {
    const cache = makeCache();
    const now = Date.now();
    await cache.save("expiring", { storageState: fixtureState() }, { cache: { ttl: "30m" } }, now);
    expect(await cache.load("expiring", now + 30 * 60_000 + 1)).toBeNull();
    expect(await cache.load("never-saved")).toBeNull();
  });

  it("prefers the auth cookie's real expiry over ttl (and falls back when absent)", async () => {
    const cache = makeCache();
    const now = Date.now();
    const state = fixtureState();
    const cookieExpiryMs = state.cookies[0]!.expires * 1000;

    const fromCookie = await cache.save(
      "editor",
      { storageState: state },
      { cache: { ttl: "1h", auth_cookie: "AppSession" } },
      now,
    );
    expect(fromCookie).toEqual({ expiresAt: cookieExpiryMs, source: 'auth-cookie "AppSession"' });

    const fallback = await cache.save(
      "editor",
      { storageState: state },
      { cache: { ttl: "1h", auth_cookie: "NotInTheJar" } },
      now,
    );
    expect(fallback.expiresAt).toBe(now + HOUR_MS);
    expect(fallback.source).toMatch(/^ttl \(fallback/);
  });

  it("uses the strategy-reported expiresAt for ttl 'session', else the 1h default", async () => {
    const cache = makeCache();
    const now = Date.now();
    const reported = now + 5 * HOUR_MS;
    const viaReported = await cache.save(
      "editor",
      { storageState: fixtureState(), expiresAt: reported },
      { cache: { ttl: "session" } },
      now,
    );
    expect(viaReported).toEqual({ expiresAt: reported, source: "strategy-reported expiresAt" });

    const viaDefault = await cache.save(
      "editor",
      { storageState: fixtureState() },
      { cache: { ttl: "session" } },
      now,
    );
    expect(viaDefault).toEqual({ expiresAt: now + HOUR_MS, source: "1h default" });
  });

  it("refuses to cache a session that is already dead", async () => {
    const cache = makeCache();
    const now = Date.now();
    const state = fixtureState();
    state.cookies[0]!.expires = Math.floor((now - 1000) / 1000); // cookie already expired
    await expect(
      cache.save(
        "editor",
        { storageState: state },
        { cache: { ttl: "1h", auth_cookie: "AppSession" } },
        now,
      ),
    ).rejects.toThrow(BackendStateCacheError);
  });

  it("stores only ciphertext on the backend — no plaintext cookie values in the envelope", async () => {
    const cache = makeCache();
    await cache.save("editor", { storageState: fixtureState() }, { cache: { ttl: "1h" } });

    const envelope = (await (
      await fetch(envelopeUrl("editor"), { headers: authedHeaders })
    ).json()) as Record<string, unknown>;
    expect(envelope.schema).toBe("docsxai/auth-cache@1");
    expect(envelope.alg).toBe("aes-256-gcm");
    expect(typeof envelope.iv).toBe("string");
    expect(typeof envelope.tag).toBe("string");
    expect(typeof envelope.expires_at).toBe("number");
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain(SESSION_COOKIE_VALUE);
    expect(wire).not.toContain("AppSession");
    expect(Buffer.from(envelope.ciphertext as string, "base64").toString("utf8")).not.toContain(
      SESSION_COOKIE_VALUE,
    );
  });

  it("surfaces tampered ciphertext as a clean typed error (GCM auth failure)", async () => {
    const cache = makeCache();
    await cache.save("editor", { storageState: fixtureState() }, { cache: { ttl: "1h" } });

    const envelope = (await (
      await fetch(envelopeUrl("editor"), { headers: authedHeaders })
    ).json()) as { ciphertext: string } & Record<string, unknown>;
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...envelope, ciphertext: bytes.toString("base64") };
    await fetch(envelopeUrl("editor"), {
      method: "PUT",
      headers: authedHeaders,
      body: JSON.stringify(tampered),
    });

    await expect(cache.load("editor")).rejects.toThrow(BackendStateCacheError);
    await expect(cache.load("editor")).rejects.toThrow(/tampered|wrong DOCSX_CACHE_KEY/);
  });

  it("fails decryption under a different key", async () => {
    const cache = makeCache();
    await cache.save("editor", { storageState: fixtureState() }, { cache: { ttl: "1h" } });

    const wrongKey = makeCache({ cacheKey: randomBytes(32).toString("base64") });
    await expect(wrongKey.load("editor")).rejects.toThrow(BackendStateCacheError);
  });

  it("clear() deletes the entry and is idempotent", async () => {
    const cache = makeCache();
    await cache.save("cleared", { storageState: fixtureState() }, { cache: { ttl: "1h" } });
    expect(await cache.load("cleared")).not.toBeNull();
    await cache.clear("cleared");
    expect(await cache.load("cleared")).toBeNull();
    await cache.clear("cleared"); // no throw on a second clear
  });

  it("rejects an absent or malformed cache key, naming DOCSX_CACHE_KEY", () => {
    expect(() => makeCache({ cacheKey: "" })).toThrow(/DOCSX_CACHE_KEY/);
    expect(() => makeCache({ cacheKey: randomBytes(16).toString("base64") })).toThrow(
      /DOCSX_CACHE_KEY.*32 bytes/,
    );
    expect(() => makeCache({ cacheKey: "!!!not-base64!!!" })).toThrow(BackendStateCacheError);
  });
});
