# @kalebtec/docsxai-plugin-starlight

docsxai **renderer plugin** for [Astro Starlight](https://starlight.astro.build/). Registers `starlight:site`, a thin adapter over the viewer's `emitStarlightSite` / `buildStarlightSite`: it turns a doc pack into a complete, buildable Starlight project — one MDX page per flow, burned screenshots preferred (clean fallback), sidebar ordered by the flow `extends` graph, theme accents derived from the style artifact's `visual` keys.

No egress: the manifest declares zero capabilities. Emission is deterministic and the emitted site is self-contained (no remote fonts, no CDN imports); `astro` + `@astrojs/starlight` versions are exact-pinned into the emitted `package.json`.

## Wiring

`.site-docs.json`:

```json
{
  "plugins": [{ "package": "@kalebtec/docsxai-plugin-starlight" }]
}
```

## Renderer config

Passed as the renderer's `config`:

| Key      | Required | Meaning                                                                            |
| -------- | -------- | ---------------------------------------------------------------------------------- |
| `title`  | no       | Site title. Default `"Documentation"`.                                             |
| `accent` | no       | Accent hex color (`#rrggbb`); overrides the style artifact's `visual` accent keys. |
| `logo`   | no       | Logo path (absolute, or relative to the workspace); overrides `visual.logo`.       |
| `build`  | no       | `true` also runs `astro build` (writes `<outDir>/dist`); default emit-only.        |

The context's `flows` filter restricts the site to those flows; empty means all flows under `docs/`.

All emission behavior (MDX shape, accent scale, image preference, determinism, the no-network posture) is documented and tested in [`@kalebtec/docsxai-viewer`](../viewer/README.md#starlight-site).

## License

[Apache-2.0](../../LICENSE).
