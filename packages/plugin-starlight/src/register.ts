// Plugin entry point — `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the renderer is `starlight:site`.

import type { PluginRegisterApi } from "@kalebtec/docsxai-engine";
import { createStarlightRenderer } from "./renderer.js";

export function register(api: PluginRegisterApi): void {
  api.registerRenderer("site", createStarlightRenderer());
}

export { createStarlightRenderer } from "./renderer.js";
