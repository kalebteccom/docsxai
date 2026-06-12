---
title: Flow-file format
description: The YAML flow schema - steps, locators, wait_for and success guards, annotations, extends, optional steps, redactions, and the environment block.
---

A flow-file is a YAML description of one user journey: an ordered list of
steps, each with a canonical locator, an action, and optional `wait_for` and
`success` guards. Steps carry `annotation` blocks that become the halos and
callouts in the rendered docs. Flows compose through `extends` (shared
preambles run first), steps can be `optional` for conditionally-present UI,
`redactions` mask sensitive regions before any pixel hits disk, and the
`environment` block (frozen clock, locale, timezone, viewport, color scheme)
is what makes replays byte-identical.

The schema is validated by Zod under the `site-docs/*@N` schema ids; this page
will grow into the full field-by-field reference.
