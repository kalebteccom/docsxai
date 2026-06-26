// Starlight site renderer — barrel re-exporting the production docs-site emitter + builder.
//
// `emitStarlightSite` writes a complete, buildable Astro Starlight project from a doc pack (one
// MDX page per flow, a landing page of flow cards, an `extends`-graph sidebar, theme accents from
// the style artifact); `buildStarlightSite` runs `astro build` over it. Emission is deterministic
// (same doc pack + config → byte-identical tree) and has no child_process; the build-toolchain
// integration is split out so the pure half stays free of process spawns.
//
// The two halves live in flat siblings:
//   - `starlight-emit.ts`  — pure project emission (deterministic, no child_process)
//   - `starlight-build.ts` — npm/astro install + build child_process spawns
// This file preserves the public surface so `./starlight.js` stays the single import path. The
// interactive single-HTML viewer (`render.ts`) is untouched — this is the production docs-site
// renderer beside it, not a replacement.

export {
  ASTRO_VERSION,
  STARLIGHT_VERSION,
  deriveFlowOrder,
  emitStarlightSite,
  normalizeAccent,
  type EmitStarlightSiteOptions,
  type EmitStarlightSiteResult,
  type StarlightSiteConfig,
} from "./starlight-emit.js";

export {
  buildStarlightSite,
  resolveAstroBin,
  type BuildStarlightSiteOptions,
  type BuildStarlightSiteResult,
} from "./starlight-build.js";
