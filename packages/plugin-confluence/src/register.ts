// Plugin entry point — `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the publisher is `confluence:push`.

import type { PluginRegisterApi } from "@kalebtec/docsxai-engine";
import { createConfluencePublisher } from "./publisher.js";

export function register(api: PluginRegisterApi): void {
  api.registerPublisher("push", createConfluencePublisher());
}

export {
  canonicalJson,
  CONTENT_SHA_PROPERTY,
  createConfluencePublisher,
  makeMasker,
  patchMediaIds,
  type ConfluencePublishConfig,
} from "./publisher.js";
