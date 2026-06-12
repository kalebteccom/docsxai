# Architecture references

Substrate-level architecture context for agents and contributors working _on_ docsxai.

- [`architecture-principles.md`](architecture-principles.md) — the Kalebtec architecture doctrine (macro layer): dependency direction, the proven-seam test, performance budgets, scalability seams. The family-wide companion to [`../agent-process/code-quality.md`](../agent-process/code-quality.md)'s micro layer.
- [`surface-map.md`](surface-map.md) — the nine workspace packages, what each owns, where the load-bearing boundaries are.
- [`documentation-contracts.md`](documentation-contracts.md) — what each documentation layer promises to the next (public docs, package READMEs, AGENTS.md, this subtree).

The repo-root [`AGENTS.md`](../../../AGENTS.md) is the high-level map. These files go one level deeper for the substructure agents most often need to navigate.
