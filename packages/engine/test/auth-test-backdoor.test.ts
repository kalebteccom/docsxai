import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStrategyConfigError, TestBackdoorStrategy } from "../src/auth.js";
import {
  FIXTURE_BACKDOOR_SECRET,
  startBackdoorServer,
  type FixtureServer,
} from "./fixtures/auth-servers.js";

let server: FixtureServer;
beforeAll(async () => {
  server = await startBackdoorServer();
});
afterAll(() => server.close());

function ctx(options: Record<string, unknown>, secret = FIXTURE_BACKDOOR_SECRET) {
  return { creds: { secret }, options, baseURL: server.url, role: "qa" };
}

describe("test-backdoor strategy", () => {
  it("POSTs the secret + user_id and captures the session cookie", async () => {
    const r = await new TestBackdoorStrategy().authenticate(
      ctx({ url: "/backdoor", user_id: "u-42", success_cookie: "backdoor_session" }),
    );
    const cookie = r.storageState.cookies.find((c) => c.name === "backdoor_session")!;
    expect(cookie.value).toBe("uid-u-42");
    expect(cookie.httpOnly).toBe(true);
    // Max-Age=3600 → a real expiry the strategy reports.
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("rejects a wrong secret without echoing it", async () => {
    const err = await new TestBackdoorStrategy()
      .authenticate(ctx({ url: "/backdoor" }, "wrong-secret-value"))
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(AuthStrategyConfigError);
    expect(err!.message).toContain("403");
    expect(err!.message).toContain("<SET>");
    expect(err!.message).not.toContain("wrong-secret-value");
  });

  it("fails when the endpoint sets no cookies", async () => {
    await expect(
      new TestBackdoorStrategy().authenticate(ctx({ url: "/backdoor-no-cookie" })),
    ).rejects.toThrow(/set no cookies/);
  });

  it("fails when the expected success_cookie is absent", async () => {
    await expect(
      new TestBackdoorStrategy().authenticate(
        ctx({ url: "/backdoor", success_cookie: "other_cookie" }),
      ),
    ).rejects.toThrow(/"other_cookie"/);
  });

  it("requires creds_env to map `secret`", async () => {
    await expect(
      new TestBackdoorStrategy().authenticate({
        creds: {},
        options: { url: "/backdoor" },
        baseURL: server.url,
        role: "qa",
      }),
    ).rejects.toThrow(/<UNSET>/);
  });
});
