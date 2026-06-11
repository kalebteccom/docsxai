import { readFileSync } from "node:fs";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { type AddressInfo } from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthStrategyConfigError,
  HttpBasicStrategy,
  MtlsStrategy,
  PatHeaderStrategy,
} from "../src/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tlsDir = path.join(here, "fixtures", "tls");
const CA_PEM = path.join(tlsDir, "test-only-ca.pem");
const SERVER_PEM = path.join(tlsDir, "test-only-server.pem");
const SERVER_KEY = path.join(tlsDir, "test-only-server.key");
const CLIENT_PEM = path.join(tlsDir, "test-only-client.pem");
const CLIENT_KEY = path.join(tlsDir, "test-only-client.key");

const BASE_URL = "https://app.example.test/dashboard";

describe("http-basic strategy", () => {
  it("emits httpCredentials and an empty storageState", async () => {
    const r = await new HttpBasicStrategy().authenticate({
      creds: { username: "u", password: "p" },
      options: {},
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.contextOptions).toEqual({ httpCredentials: { username: "u", password: "p" } });
    expect(r.storageState).toEqual({ cookies: [], origins: [] });
    expect(r.expiresAt).toBeUndefined();
  });

  it("missing creds fail with masked diagnostics", async () => {
    const err = await new HttpBasicStrategy()
      .authenticate({
        creds: { username: "distinct-user-value" },
        options: {},
        baseURL: BASE_URL,
        role: "e",
      })
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err).toBeInstanceOf(AuthStrategyConfigError);
    expect(err!.message).toContain('"password" (<UNSET>)');
    expect(err!.message).toContain('"username" (<SET>)');
    expect(err!.message).not.toContain("distinct-user-value");
  });
});

describe("pat-header strategy", () => {
  it("defaults to Authorization: Bearer {{token}}", async () => {
    const r = await new PatHeaderStrategy().authenticate({
      creds: { token: "pat-123" },
      options: {},
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.contextOptions).toEqual({
      extraHTTPHeaders: { Authorization: "Bearer pat-123" },
    });
    expect(r.storageState).toEqual({ cookies: [], origins: [] });
  });

  it("honors a custom header name and value template", async () => {
    const r = await new PatHeaderStrategy().authenticate({
      creds: { token: "pat-123" },
      options: { header: "X-Api-Key", value_template: "{{token}}" },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.contextOptions).toEqual({ extraHTTPHeaders: { "X-Api-Key": "pat-123" } });
  });

  it("requires the token cred, masked when absent", async () => {
    await expect(
      new PatHeaderStrategy().authenticate({
        creds: {},
        options: {},
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/token: <UNSET>/);
  });

  it("rejects unknown option keys", async () => {
    await expect(
      new PatHeaderStrategy().authenticate({
        creds: { token: "t" },
        options: { headr: "typo" },
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(AuthStrategyConfigError);
  });
});

describe("mtls strategy", () => {
  const CREDS = { cert: CLIENT_PEM, key: CLIENT_KEY };

  it("produces clientCertificates with paths, defaulting origin to the baseURL origin", async () => {
    const r = await new MtlsStrategy().authenticate({
      creds: CREDS,
      options: {},
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.contextOptions).toEqual({
      clientCertificates: [
        { origin: "https://app.example.test", certPath: CLIENT_PEM, keyPath: CLIENT_KEY },
      ],
    });
    expect(r.storageState).toEqual({ cookies: [], origins: [] });
  });

  it("honors an explicit origin and forwards a passphrase cred without logging it", async () => {
    const r = await new MtlsStrategy().authenticate({
      creds: { ...CREDS, passphrase: "key-passphrase" },
      options: { origin: "https://api.example.test" },
      baseURL: BASE_URL,
      role: "editor",
    });
    expect(r.contextOptions!.clientCertificates).toEqual([
      {
        origin: "https://api.example.test",
        certPath: CLIENT_PEM,
        keyPath: CLIENT_KEY,
        passphrase: "key-passphrase",
      },
    ]);
  });

  it("fails when a file is missing — naming the path, not any contents", async () => {
    await expect(
      new MtlsStrategy().authenticate({
        creds: { cert: path.join(tlsDir, "nope.pem"), key: CLIENT_KEY },
        options: {},
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/cert file not readable/);
  });

  it("fails when a file is not PEM-shaped", async () => {
    await expect(
      new MtlsStrategy().authenticate({
        creds: { cert: CLIENT_PEM, key: path.join(tlsDir, "README.md") },
        options: {},
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/does not look like PEM/);
  });

  it("requires cert and key creds (paths), masked when absent", async () => {
    await expect(
      new MtlsStrategy().authenticate({
        creds: { cert: CLIENT_PEM },
        options: {},
        baseURL: BASE_URL,
        role: "editor",
      }),
    ).rejects.toThrow(/"key" \(<UNSET>\)/);
  });
});

describe("mtls round-trip against a requestCert https server", () => {
  let server: ReturnType<typeof createHttpsServer>;
  let port: number;

  beforeAll(async () => {
    server = createHttpsServer(
      {
        key: readFileSync(SERVER_KEY),
        cert: readFileSync(SERVER_PEM),
        ca: readFileSync(CA_PEM),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function probe(withClientCert: boolean): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/",
          ca: readFileSync(CA_PEM),
          ...(withClientCert
            ? { cert: readFileSync(CLIENT_PEM), key: readFileSync(CLIENT_KEY) }
            : {}),
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("accepts a request presenting the fixture client cert", async () => {
    await expect(probe(true)).resolves.toBe(200);
  });

  it("rejects the TLS handshake without a client cert", async () => {
    await expect(probe(false)).rejects.toThrow();
  });
});
