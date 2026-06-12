---
title: Quickstart
description: Init a workspace, write your first flow, run it against your app, and render the doc pack.
---

A doc pack lives in its own workspace directory, never inside the target app's
repo. The short version of the loop:

```sh
site-docs init ~/site-docs/my-app
# author flows/<name>.flow.yaml (agent-assisted or by hand)
site-docs run ~/site-docs/my-app --flow my-flow
site-docs render ~/site-docs/my-app
```

`run` replays the flow deterministically against the running app and captures
clean screenshots; `render` overlays halos, badges, and callouts from the
flow's annotations. The full setup story, including auth capture for logged-in
apps, is in the [agent runbook](/guides/agent-runbook/).
