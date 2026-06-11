import { describe, expect, it } from "vitest";
import {
  AuthStrategyConfigError,
  TotpStrategy,
  base32Decode,
  base32Encode,
  generateHotp,
  generateTotp,
  totpCodesAround,
  verifyTotp,
} from "../src/auth.js";

// RFC 6238 Appendix B reference keys: the ASCII seed repeated to the algorithm's key length.
const SHA1_KEY = Buffer.from("12345678901234567890", "ascii");
const SHA256_KEY = Buffer.from("12345678901234567890123456789012", "ascii");

// RFC 6238 Appendix B test vectors (8 digits, T0 = 0, X = 30s).
const RFC6238_SHA1_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];
const RFC6238_SHA256_VECTORS: Array<[number, string]> = [
  [59, "46119246"],
  [1111111109, "68084774"],
  [1111111111, "67062674"],
  [1234567890, "91819424"],
  [2000000000, "90698825"],
  [20000000000, "77737706"],
];

// RFC 4226 Appendix D HOTP vectors (6 digits, SHA-1, counters 0–9).
const RFC4226_HOTP_VECTORS = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

describe("base32 (RFC 4648)", () => {
  it("decodes the canonical alphabet", () => {
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString("ascii")).toBe(
      "12345678901234567890",
    );
  });

  it("is case-insensitive and tolerates padding and whitespace", () => {
    expect(base32Decode("gezdgnbvgy3tqojqgezdgnbvgy3tqojq").toString("ascii")).toBe(
      "12345678901234567890",
    );
    expect(base32Decode("MZXW6===").toString("ascii")).toBe("foo");
    expect(base32Decode("MZXW 6YTB OI==").toString("ascii")).toBe("foobar");
  });

  it("round-trips through base32Encode", () => {
    expect(base32Encode(SHA1_KEY)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(base32Encode(SHA256_KEY)).equals(SHA256_KEY)).toBe(true);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1===")).toThrow(AuthStrategyConfigError);
    expect(() => base32Decode("MZXW8===")).toThrow(/invalid character/);
  });

  it("decodes the empty string to an empty buffer", () => {
    expect(base32Decode("").length).toBe(0);
  });
});

describe("HOTP (RFC 4226 Appendix D)", () => {
  it("matches the ten reference codes for counters 0–9", () => {
    for (let counter = 0; counter < RFC4226_HOTP_VECTORS.length; counter++) {
      expect(generateHotp(SHA1_KEY, counter)).toBe(RFC4226_HOTP_VECTORS[counter]);
    }
  });
});

describe("TOTP (RFC 6238 Appendix B)", () => {
  it.each(RFC6238_SHA1_VECTORS)("SHA-1, 8 digits @ T=%is → %s", (timeSec, expected) => {
    expect(generateTotp(SHA1_KEY, { at: timeSec * 1000, digits: 8 })).toBe(expected);
  });

  it.each(RFC6238_SHA256_VECTORS)("SHA-256, 8 digits @ T=%is → %s", (timeSec, expected) => {
    expect(generateTotp(SHA256_KEY, { at: timeSec * 1000, digits: 8, algorithm: "sha256" })).toBe(
      expected,
    );
  });

  it("accepts the secret as a base32 string (the authenticator-app form)", () => {
    expect(generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", { at: 59_000, digits: 8 })).toBe(
      "94287082",
    );
  });

  it("defaults to 6 digits — the last 6 of the 8-digit vector", () => {
    expect(generateTotp(SHA1_KEY, { at: 59_000 })).toBe("287082");
  });

  it("honors a custom period", () => {
    // 60s steps: T=59s and T=119s share counter 0 / 1 with the 30s vectors at 2x time.
    expect(generateTotp(SHA1_KEY, { at: 119_000, period: 60, digits: 8 })).toBe(
      generateTotp(SHA1_KEY, { at: 59_000, digits: 8 }),
    );
  });

  it("accepts a Date for `at`", () => {
    expect(generateTotp(SHA1_KEY, { at: new Date(59_000), digits: 8 })).toBe("94287082");
  });
});

describe("drift window", () => {
  it("totpCodesAround yields centre, then ±1 steps, deduplicating nothing", () => {
    const at = 1111111111 * 1000;
    const codes = totpCodesAround(SHA1_KEY, { at, digits: 8, window: 1 });
    expect(codes).toHaveLength(3);
    expect(codes[0]).toBe("14050471"); // centre (T=1111111111)
    expect(codes).toContain("07081804"); // previous step (T=1111111109)
  });

  it("verifyTotp accepts the previous step's code within window 1 and rejects it at window 0", () => {
    const at = 1111111111 * 1000;
    expect(verifyTotp("07081804", SHA1_KEY, { at, digits: 8, window: 1 })).toBe(true);
    expect(verifyTotp("07081804", SHA1_KEY, { at, digits: 8, window: 0 })).toBe(false);
    expect(verifyTotp("00000000", SHA1_KEY, { at, digits: 8, window: 1 })).toBe(false);
  });

  it("never asks HOTP for a negative counter near the epoch", () => {
    expect(() => totpCodesAround(SHA1_KEY, { at: 5_000, window: 1 })).not.toThrow();
    expect(totpCodesAround(SHA1_KEY, { at: 5_000, window: 1 })).toHaveLength(2);
  });
});

describe("TotpStrategy (standalone catalogue entry)", () => {
  it("refuses to authenticate, pointing at the ui-form composition", () => {
    const s = new TotpStrategy();
    expect(() =>
      s.authenticate({ creds: {}, options: {}, baseURL: "http://127.0.0.1", role: "editor" }),
    ).toThrow(/ui-form/);
  });
});
