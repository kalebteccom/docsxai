import { describe, expect, it } from "vitest";
import { DENY_PRIVATE_APP_URL_ENV } from "../src/app-url.js";
import { EGRESS_DENY_PRIVATE_ENV, EGRESS_GUARD_ENV, webhookEngineEnv } from "../src/runner.js";

describe("webhookEngineEnv", () => {
  it("turns the engine request guard on by default and leaves the rest of the environment alone", () => {
    const env = webhookEngineEnv({ PATH: "/bin", OTHER: "x" });
    expect(env).toEqual({ PATH: "/bin", OTHER: "x", [EGRESS_GUARD_ENV]: "1" });
  });

  it.each(["0", "false", "no", "NO", " False "])("honours an explicit off value %j", (v) => {
    expect(webhookEngineEnv({ [EGRESS_GUARD_ENV]: v })[EGRESS_GUARD_ENV]).toBe(v);
  });

  it.each(["1", "true", "yes", "tru", "off", "2", ""])("keeps the guard on for %j", (v) => {
    expect(webhookEngineEnv({ [EGRESS_GUARD_ENV]: v })[EGRESS_GUARD_ENV]).toBe("1");
  });

  it("refuses private ranges in the engine when the backend refuses them in an app_url", () => {
    expect(webhookEngineEnv({ [DENY_PRIVATE_APP_URL_ENV]: "yes" })[EGRESS_DENY_PRIVATE_ENV]).toBe(
      "1",
    );
    expect(webhookEngineEnv({})[EGRESS_DENY_PRIVATE_ENV]).toBeUndefined();
  });

  it("does not override a deny-private value the operator set", () => {
    const env = webhookEngineEnv({
      [DENY_PRIVATE_APP_URL_ENV]: "1",
      [EGRESS_DENY_PRIVATE_ENV]: "0",
    });
    expect(env[EGRESS_DENY_PRIVATE_ENV]).toBe("0");
  });
});
