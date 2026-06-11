// @kalebtec/docsxai-engine
// LLM-agnostic engine: flow-file parser + deterministic runtime + the target-site auth-strategy
// layer + calibration-aid helpers (lint, diagnose, flow-tree, style) + doc-pack IO.

export const name = "@kalebtec/docsxai-engine";

export * from "./doc-pack.js";
export * from "./flow-file.js";
export * from "./flow-runtime.js";
export * from "./auth.js";
export * from "./calibrate.js";
export * from "./playwright-driver.js";
export * from "./playwright-instrumented-browser.js";
export * from "./workspace.js";
