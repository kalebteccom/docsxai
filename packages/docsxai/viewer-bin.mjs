#!/usr/bin/env node
// `docsxai-viewer`: the viewer's own CLI (build, burn, site, pack), shipped by the meta package so
// one global install of `docsxai` puts it on the path. @docsxai/viewer is a dependency, so its bin
// would not be linked by a global install of this package; this runs its CLI in-process instead.

const { runViewerCli } = await import("@docsxai/viewer");
process.exit(await runViewerCli(process.argv.slice(2)));
