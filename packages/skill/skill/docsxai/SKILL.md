---
name: docsxai
description: Vendored fallback for teams that want to pin docsxai behavior into a project. Use to walk a web app, follow written flows, and emit screenshot-rich docs. Prefer the installed @docsxai/plugin if present; this skill just points at it.
---

# docsxai (vendored fallback)

This is the _secondary_ path. The first-class surface is the **@docsxai/plugin Claude Code plugin** — if it's installed, use it directly:

- Calibration (agent-driven): the plugin's `docsxai-calibrate` skill (discovery → mapping+testing → commit, producing a doc pack) and `docsxai-diagnose` (the explicit failure path when a deterministic run halts on drift).
- Deterministic execution: `/docsxai:run <project-dir>` (re-run flow-files, refresh `annotations.json` + screenshots), `/docsxai:render <project-dir>` (build the viewer), `/docsxai:login`.

This vendored copy exists only so a project can version-pin the behavior (e.g. for reproducible client engagements). It carries no logic of its own — it delegates to the plugin's commands/skills and the `docsxai` / `docsxai-viewer` / `docsxai-backend` CLIs. Keep it in sync with the plugin version you intend to use.

Design + the full calibration playbook live in the `project-ideas` portfolio (`projects/automated-site-documentation-bot/`) and in the plugin's `skills/calibrate/SKILL.md`.
