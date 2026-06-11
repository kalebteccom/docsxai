// `mtls` — connection-level auth: the browser context presents a client certificate during the
// TLS handshake. The creds env vars hold *paths* to the PEM files (cert/key stay on disk; the
// strategy validates they exist and look like PEM but never reads them into logs or errors).
// An optional `passphrase` cred decrypts an encrypted key. Empty storageState;
// `contextOptions.clientCertificates` carries the paths through to Playwright.

import { promises as fs } from "node:fs";
import { z } from "zod";
import {
  AuthStrategyConfigError,
  emptyStorageState,
  maskSecret,
  parseStrategyOptions,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export const MtlsOptions = z
  .object({
    /** Origin the certificate applies to. Default: the target's baseURL origin. */
    origin: z.string().min(1).optional(),
  })
  .strict();
export type MtlsOptions = z.infer<typeof MtlsOptions>;

async function assertPemFile(role: "cert" | "key", filePath: string): Promise<void> {
  let head: string;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buf, 0, 64, 0);
      head = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    throw new AuthStrategyConfigError(`mtls: ${role} file not readable: ${filePath}`);
  }
  if (!head.includes("-----BEGIN ")) {
    throw new AuthStrategyConfigError(
      `mtls: ${role} file does not look like PEM (expected a "-----BEGIN …-----" header): ${filePath}`,
    );
  }
}

export class MtlsStrategy implements AuthStrategy {
  readonly name = "mtls" as const;

  async authenticate(ctx: AuthContext): Promise<AuthResult> {
    const opts = parseStrategyOptions(this.name, MtlsOptions, ctx.options);
    const { cert: certPath, key: keyPath, passphrase } = ctx.creds;
    if (!certPath || !keyPath) {
      throw new AuthStrategyConfigError(
        `mtls: creds_env must map "cert" (${maskSecret(certPath)}) and "key" (${maskSecret(keyPath)}) to env vars holding PEM file *paths*`,
      );
    }
    await assertPemFile("cert", certPath);
    await assertPemFile("key", keyPath);

    const origin = opts.origin ?? new URL(ctx.baseURL).origin;
    return {
      storageState: emptyStorageState(),
      contextOptions: {
        clientCertificates: [{ origin, certPath, keyPath, ...(passphrase ? { passphrase } : {}) }],
      },
    };
  }
}
