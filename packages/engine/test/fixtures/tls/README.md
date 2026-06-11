# Test-only TLS fixtures

Throwaway, self-signed certificates for the mTLS auth-strategy tests. Generated once with
`openssl` (RSA-2048, 10-year validity, CN=localhost / SAN 127.0.0.1) and committed on purpose:
X.509 material cannot be minted with `node:crypto` alone, and deterministic fixtures beat
regenerating at test time.

- `test-only-ca.{pem,key}` — the throwaway CA that signs both leaf certs.
- `test-only-server.{pem,key}` — the fixture HTTPS server's identity (`localhost` / `127.0.0.1`).
- `test-only-client.{pem,key}` — the client certificate the mTLS strategy presents.

**These keys secure nothing.** They never leave the test suite, are trusted by no real system,
and must never be reused outside `packages/engine/test/`. If they ever bother a secret scanner,
regenerate them with any CN=localhost self-signed setup — the tests only assert chain validity,
not specific bytes.
