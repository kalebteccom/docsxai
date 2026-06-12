import { describe, expect, it } from "vitest";
import { signGitHubPayload, verifyGitHubSignature } from "../src/webhook.js";

const SECRET = "It's a Secret to Everybody";
const BODY = Buffer.from("Hello, World!");

describe("X-Hub-Signature-256 verification", () => {
  it("accepts a correctly signed payload (GitHub's documented example vector)", () => {
    // https://docs.github.com/webhooks: secret + body above produce exactly this digest.
    const expected = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(signGitHubPayload(SECRET, BODY)).toBe(expected);
    expect(verifyGitHubSignature(SECRET, BODY, expected)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const sig = signGitHubPayload("wrong-secret", BODY);
    expect(verifyGitHubSignature(SECRET, BODY, sig)).toBe(false);
  });

  it("rejects a valid signature over different bytes", () => {
    const sig = signGitHubPayload(SECRET, Buffer.from("tampered"));
    expect(verifyGitHubSignature(SECRET, BODY, sig)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyGitHubSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, "")).toBe(false);
  });

  it("rejects malformed headers without throwing (timing-safe path needs equal lengths)", () => {
    expect(verifyGitHubSignature(SECRET, BODY, "sha1=deadbeef")).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, "sha256=nothex")).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, "sha256=abc123")).toBe(false); // too short
    expect(verifyGitHubSignature(SECRET, BODY, signGitHubPayload(SECRET, BODY) + "00")).toBe(false);
  });

  it("signs strings and Buffers identically", () => {
    expect(signGitHubPayload(SECRET, BODY.toString("utf8"))).toBe(signGitHubPayload(SECRET, BODY));
  });
});
