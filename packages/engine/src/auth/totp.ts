// Dep-free RFC 6238 TOTP (over RFC 4226 HOTP) with `node:crypto`.
//
// `totp` is not a standalone login scheme — a one-time code is one *field* of an interactive
// login — so the catalogue entry composes `ui-form` (set `options.totp` there). The primitives
// are exported for that hook, for fixture servers, and for future CLI/MCP surfacing.

import { createHmac } from "node:crypto";
import {
  AuthStrategyConfigError,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode an RFC 4648 base32 string (case-insensitive; `=` padding and inner whitespace tolerated). */
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return Buffer.alloc(0);
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new AuthStrategyConfigError(`base32: invalid character "${ch}"`);
    }
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** Encode bytes as RFC 4648 base32 (no padding). Test/fixture aid; authenticator secrets arrive base32. */
export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export type TotpAlgorithm = "sha1" | "sha256";

export interface TotpOptions {
  /** Wall-clock instant the code is for. Epoch ms (or a `Date`). Default: now. */
  at?: number | Date;
  /** Code length: 6 (default) or 8. */
  digits?: 6 | 8;
  /** Time-step in seconds. Default 30. */
  period?: number;
  /** HMAC algorithm. Default `sha1` (what authenticator apps implement). */
  algorithm?: TotpAlgorithm;
}

/** RFC 4226 HOTP: HMAC the 8-byte big-endian counter, dynamic-truncate, mod 10^digits. */
export function generateHotp(
  key: Uint8Array,
  counter: number | bigint,
  digits: 6 | 8 = 6,
  algorithm: TotpAlgorithm = "sha1",
): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(counterBuf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binCode =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

function keyOf(secret: string | Uint8Array): Buffer {
  return typeof secret === "string" ? base32Decode(secret) : Buffer.from(secret);
}

function counterAt(at: number | Date | undefined, period: number): bigint {
  const ms = at instanceof Date ? at.getTime() : (at ?? Date.now());
  return BigInt(Math.floor(ms / 1000 / period));
}

/** RFC 6238 TOTP for `secret` (base32 string, or raw key bytes). */
export function generateTotp(secret: string | Uint8Array, opts: TotpOptions = {}): string {
  const period = opts.period ?? 30;
  return generateHotp(
    keyOf(secret),
    counterAt(opts.at, period),
    opts.digits ?? 6,
    opts.algorithm ?? "sha1",
  );
}

/**
 * Codes for the time-steps within ±`window` of `at` (clock-drift tolerance), centre first.
 * `window: 1` (the common server allowance) yields the current, previous, and next codes.
 */
export function totpCodesAround(
  secret: string | Uint8Array,
  opts: TotpOptions & { window?: number } = {},
): string[] {
  const period = opts.period ?? 30;
  const window = opts.window ?? 1;
  const key = keyOf(secret);
  const centre = counterAt(opts.at, period);
  const codes: string[] = [];
  for (let drift = 0; drift <= window; drift++) {
    for (const counter of drift === 0
      ? [centre]
      : [centre - BigInt(drift), centre + BigInt(drift)]) {
      if (counter < 0n) continue;
      codes.push(generateHotp(key, counter, opts.digits ?? 6, opts.algorithm ?? "sha1"));
    }
  }
  return codes;
}

/** True when `code` matches any time-step within ±`window` (default 1) of `at`. */
export function verifyTotp(
  code: string,
  secret: string | Uint8Array,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  return totpCodesAround(secret, opts).includes(code);
}

/**
 * The standalone `totp` catalogue entry. A TOTP is one field of an interactive login, not a whole
 * scheme — authenticating with it alone is a config error that points at the composition.
 */
export class TotpStrategy implements AuthStrategy {
  readonly name = "totp" as const;

  authenticate(_ctx: AuthContext): Promise<AuthResult> {
    throw new AuthStrategyConfigError(
      "strategy `totp` is not a standalone login — use strategy `ui-form` with " +
        "options.totp: { secret_env: <ENV-VAR NAME>, otp_selector: <css>, submit_selector?: <css> }; " +
        "the TOTP primitives (generateTotp / verifyTotp) are exported for direct use",
    );
  }
}
