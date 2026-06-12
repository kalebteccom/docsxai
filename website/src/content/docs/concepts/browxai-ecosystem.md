---
title: The browxai ecosystem
description: How docsxai relates to browxai - live-page discovery during calibration, and the actionability contract the two share.
---

docsxai deliberately ships no live-page discovery surface: no click, fill, or
inspect on an arbitrary page. During calibration, that job belongs to
[browxai](https://github.com/kalebteccom/browxai), an MCP-native browser built
for agents. The host agent uses browxai's `find()` and `snapshot()` to pick
canonical locators on the live app, then writes them into a flow-file that the
docsxai engine replays without any agent at all.

The two tools meet at the [actionability contract](/reference/actionability/):
a shared element-state vocabulary that lets a calibration agent know at
write-time whether a selector is fillable, clickable, or scopable. Keeping the
surfaces disjoint is what keeps `site-docs run` reproducible.
