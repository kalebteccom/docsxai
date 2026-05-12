// @kalebtec/site-docs-engine
// LLM-agnostic engine: calibration pipeline stages (discovery, mapping+testing, commit)
// + flow-file parser/runtime + the target-site auth-strategy layer.
//
// Design: see PHASE-0.md at the repo root and the spec/roadmap in the project-ideas
// portfolio (projects/automated-site-documentation-bot/).

export const name = "@kalebtec/site-docs-engine";

export * from "./doc-pack.js";
export * from "./flow-file.js";
export * from "./flow-runtime.js";
export * from "./pipeline.js";
export * from "./auth.js";
