---
id: INV-PURE-CORE
title: Domain core performs no I/O; every non-deterministic input is an argument
status: active
owner: "@Mixerod"
enforced_by:
  - file:anchoring.guards.mjs
holds_for:
  - file:src/config.ts
  - file:src/config-architecture.ts
  - file:src/store.ts
  - file:src/verify.ts
  - file:src/why.ts
  - file:src/ctx.ts
  - file:src/done.ts
  - file:src/guards.ts
  - file:src/owners.ts
  - file:src/model.ts
  - file:src/frontmatter.ts
  - file:src/anchors.ts
---

# INV-PURE-CORE: Domain core performs no I/O; every non-deterministic input is an argument

## Rule

Domain logic that performs direct I/O cannot be tested without mocks, cannot be run deterministically in different runtime environments, and hides its failure modes.

The pure domain layer performs no I/O. Reading files, child processes, networks, clocks, and random sources are forbidden in this layer; all non-deterministic inputs must be passed as arguments.

## Enforcement

Enforced by ESLint rules `no-restricted-imports`, `no-restricted-globals`, and `no-restricted-properties` generated in `anchoring.guards.mjs` and composed into `eslint.config.js`.
