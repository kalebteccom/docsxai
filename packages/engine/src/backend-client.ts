// HTTP client for `@docsxai/backend`. Used by `docsxai push` / `pull` / `login` / `run`.
//
// Barrel: the implementation lives in flat siblings, split by reason-to-change. This file preserves
// the original public surface so `./backend-client.js` importers (and colocated tests) don't move.
//   • backend-client-contracts.ts   — wire DTOs / payloads / error class / option shapes (the leaf)
//   • backend-client-transport.ts    — the REST `BackendClient` + `createBackendClient` + run history
//   • backend-client-token.ts        — stored-token file + bearer-token resolution / refresh
//   • backend-client-oauth-login.ts  — the OAuth 2.1 + PKCE login flow
//   • backend-client-state-cache.ts  — the AES-256-GCM `BackendStateCache` relay
//
// The contract types are *redeclared* in the contracts leaf (not imported from the backend package)
// so the engine stays decoupled at the package level — there's no runtime nor build-time dep on the
// backend. Drift is caught by the round-trip integration test that spins up a real stub.

export * from "./backend-client-contracts.js";
export * from "./backend-client-transport.js";
export * from "./backend-client-token.js";
export * from "./backend-client-oauth-login.js";
export * from "./backend-client-state-cache.js";
