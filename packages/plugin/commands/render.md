---
description: Build the interactive docs viewer for a project from its doc pack.
argument-hint: <project-dir>
---

Build the static viewer:

```
site-docs render $ARGUMENTS
```

(Under the hood this runs `site-docs-viewer build <project-dir>/docs <project-dir>/.viewer`.) Report where
the viewer was written and how many pages it generated. If `site-docs-viewer` isn't found, run it directly:
`site-docs-viewer build <project-dir>/docs <project-dir>/.viewer`.
