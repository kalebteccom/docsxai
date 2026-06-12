---
title: The doc pack
description: The workspace artifact set - flow-files, clean and burned screenshots, annotations.json, style artifacts, and run history.
---

A doc pack is the complete, portable output of a documented app: the
flow-files that describe each user journey, the clean screenshots a run
captures, the `annotations.json` that places halos and callouts over them, the
style artifact that keeps the prose voice consistent, and the rendered docs
themselves. It lives in a workspace directory that is separate from the target
app's repo and is safe to commit, zip, or push to the backend.

Because every artifact derives from the flow-files deterministically, the pack
re-renders from scratch on every run. Nothing in it is hand-retouched.
