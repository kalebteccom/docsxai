// The starlight:site renderer — a thin adapter from the engine's RendererPlugin contract onto
// the viewer's `emitStarlightSite` / `buildStarlightSite`. All emission logic (MDX, config,
// accent derivation, burned-image preference, determinism) lives in the viewer; this maps the
// renderer context's `config` keys (title / accent / logo / build) and flow filter through.

import * as path from "node:path";
import type { RendererContext, RendererPlugin, RendererResult } from "@kalebtec/docsxai-engine";
import {
  buildStarlightSite,
  emitStarlightSite,
  type StarlightSiteConfig,
} from "@kalebtec/docsxai-viewer";

function stringOpt(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function createStarlightRenderer(): RendererPlugin {
  return {
    async render(ctx: RendererContext): Promise<RendererResult> {
      const title = stringOpt(ctx.config, "title");
      const accent = stringOpt(ctx.config, "accent");
      const logo = stringOpt(ctx.config, "logo");
      const config: StarlightSiteConfig = {
        ...(title !== undefined ? { title } : {}),
        ...(accent !== undefined ? { accent } : {}),
        ...(logo !== undefined ? { logo } : {}),
        ...(ctx.flows.length > 0 ? { flows: ctx.flows } : {}),
      };

      const emitted = await emitStarlightSite({
        workspaceDir: ctx.workspaceDir,
        outDir: ctx.outDir,
        config,
      });
      for (const w of emitted.warnings) ctx.log.warn(w);
      ctx.log.info(`emitted ${String(emitted.files.length)} file(s) to ${ctx.outDir}`);
      const outputs = emitted.files.map((f) => path.join(ctx.outDir, f));

      if (ctx.config["build"] === true) {
        const built = await buildStarlightSite({ siteDir: ctx.outDir });
        if (!built.ok) {
          ctx.log.error(`astro build failed\n${built.stderr}`);
          return { ok: false, outputs, warnings: [...emitted.warnings, "astro build failed"] };
        }
        ctx.log.info(`astro build finished in ${String(Math.round(built.durationMs))}ms`);
        outputs.push(built.distDir);
      }

      return { ok: true, outputs, warnings: emitted.warnings };
    },
  };
}
