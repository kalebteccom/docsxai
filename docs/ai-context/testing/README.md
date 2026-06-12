# Testing references

The testing discipline for docsxai: trophy layering, when to mock vs. use real, the keystone test as regression gate.

- [`qa-patterns.md`](qa-patterns.md) — the playbook. Testing Trophy applied to docsxai, capturing-mock pattern, inverted-assertion trap, AHA testing, the keystone-vs-unit rule.
- [`unit-vs-keystone.md`](unit-vs-keystone.md) — the one-screen layer decision rule (pure logic → unit; composed pipeline → integration; touches a real page → keystone, no exceptions).

The keystone test (`packages/engine/test/keystone.test.ts`) runs as part of `pnpm test`. It drives the runtime end-to-end against real Chromium with a fixture site. **Don't shortcut it** — unit tests against a mocked `BrowserDriver` silently pass when the real Playwright integration is broken.
