// @kalebtec/docsxai-engine
// LLM-agnostic engine: flow-file parser + deterministic runtime + the target-site auth-strategy
// layer + calibration-aid helpers (lint, diagnose, flow-tree, style) + doc-pack IO, the backend
// client, and the zip hand-off packager.

export const name = "@kalebtec/docsxai-engine";

export * from "./doc-pack.js";
export * from "./doc-pack-io.js";
export * from "./flow-file.js";
export * from "./flow-runtime.js";
export * from "./flow-lint.js";
export * from "./flow-tree.js";
export * from "./auth.js";
export * from "./backend-client.js";
export * from "./calibrate.js";
export * from "./diagnose.js";
export * from "./playwright-driver.js";
export * from "./playwright-instrumented-browser.js";
export * from "./style.js";
export * from "./workspace.js";
export * from "./zip.js";
export * from "./plugins/types.js";
export * from "./plugins/manifest.js";
export * from "./plugins/registry.js";
export * from "./plugins/runtime.js";
export * from "./plugins/lock.js";
export * from "./redact.js";
export * from "./viewer-bin.js";
