---
name: site-docs
description: Vendored fallback for teams that want to pin site-docs behavior into a project. Use to walk a web app, follow written flows, and emit screenshot-rich docs. Prefer the installed @kalebtec/docsxai-plugin if present; this skill just points at it.
---

# site-docs (vendored fallback)

This is the *secondary* path. The first-class surface is the **@kalebtec/docsxai-plugin Claude Code plugin** — if it's installed, use it directly:

- Calibration (agent-driven): the plugin's `site-docs-calibrate` skill (discovery → mapping+testing → commit, producing a doc pack) and `site-docs-diagnose` (the explicit failure path when a deterministic run halts on drift).
- Deterministic execution: `/site-docs:run <project-dir>` (re-run flow-files, refresh `annotations.json` + screenshots), `/site-docs:render <project-dir>` (build the viewer), `/site-docs:login`.

This vendored copy exists only so a project can version-pin the behavior (e.g. for reproducible client engagements). It carries no logic of its own — it delegates to the plugin's commands/skills and the `site-docs` / `docsxai-viewer` / `docsxai-backend` CLIs. Keep it in sync with the plugin version you intend to use.

Design + the full calibration playbook live in the `project-ideas` portfolio (`projects/automated-site-documentation-bot/`) and in the plugin's `skills/calibrate/SKILL.md`.
