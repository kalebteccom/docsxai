---
description: Build the interactive docs viewer for a project from its doc pack.
argument-hint: <project-dir>
---

Build the static viewer:

```
site-docs render $ARGUMENTS
```

(Under the hood this runs `docsxai-viewer build <project-dir>/docs <project-dir>/.viewer`.) Report where
the viewer was written and how many pages it generated. If `docsxai-viewer` isn't found, run it directly:
`docsxai-viewer build <project-dir>/docs <project-dir>/.viewer`.
