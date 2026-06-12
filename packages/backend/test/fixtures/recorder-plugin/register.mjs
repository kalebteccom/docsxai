// Recorder publisher plugin (engine register(api) contract). Writes every publish() call into
// the workspace so tests can assert the wiki-push strategy invoked it with the right context.
import * as fs from "node:fs";
import * as path from "node:path";

export function register(api) {
  api.registerPublisher("push", {
    async publish(ctx) {
      fs.writeFileSync(
        path.join(ctx.workspaceDir, "publish-call.json"),
        JSON.stringify({ config: ctx.config, projection: ctx.projection }, null, 2),
      );
      return {
        ok: true,
        target: "fake-wiki/SPACE",
        pages: [
          { id: "p1", action: "created", section: "intro" },
          { id: "p2", action: "updated", section: "flows" },
        ],
        warnings: [],
      };
    },
  });
}
