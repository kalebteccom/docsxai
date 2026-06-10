// @kalebtec/docsxai-engine
// LLM-agnostic engine: calibration pipeline stages (discovery, mapping+testing, commit)
// + flow-file parser/runtime + the target-site auth-strategy layer.
//
// Design: see PHASE-0.md at the repo root and the spec/roadmap in the project-ideas
// portfolio (projects/automated-site-documentation-bot/).

export const name = "@kalebtec/docsxai-engine";

export * from "./doc-pack.js";
export * from "./flow-file.js";
export * from "./flow-runtime.js";
export * from "./pipeline.js";
export * from "./auth.js";
export * from "./calibrate.js";
export * from "./playwright-driver.js";
export * from "./playwright-instrumented-browser.js";
export * from "./workspace.js";
