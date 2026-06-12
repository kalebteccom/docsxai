---
title: Introduction
description: What docsxai is, the problem it solves, and the calibrate / run / render / publish loop it implements.
---

docsxai is an LLM-agnostic engine plus a Claude Code plugin that walks a running
web app, follows written flows, and emits screenshot-rich user documentation.
You describe a user journey once as a flow-file; the `site-docs` CLI replays it
deterministically, captures annotated screenshots, and renders a publishable
doc pack.

Calibration (authoring the flow with an agent's help) happens once and rarely.
Execution is deterministic and agent-free: no model in the loop, no token bill
per refresh, and the same flow against the same target state produces
byte-identical screenshots. That is what makes the docs cheap to keep current
in CI.
