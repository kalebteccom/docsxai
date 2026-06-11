// Target-site auth layer — re-export shim. The implementation lives under `auth/`
// (one module per strategy); existing imports of `./auth.js` keep working unchanged.

export * from "./auth/index.js";
