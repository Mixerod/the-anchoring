---
id: INV-INJECTED-IO
title: Core modules receive I/O boundaries injected as arguments
status: active
owner: "@Mixerod"
enforced_by:
  - file:eslint.config.js
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

# INV-INJECTED-IO: Core modules receive I/O boundaries injected as arguments

## Rule

Core domain modules (`config.ts`, `store.ts`, `verify.ts`, `why.ts`, `ctx.ts`, `done.ts`, `guards.ts`, `owners.ts`, `model.ts`, `frontmatter.ts`, `anchors.ts`) must remain pure functions over in-memory data structures. Git execution, codegraph symbol queries, clock reads, and filesystem I/O must reach the core as injected arguments or via dedicated infra modules (`git.ts`, `loader.ts`, `resolver.ts`, `session.ts`, `root.ts`).

## Enforcement

Enforced by ESLint rule `no-restricted-imports` composed from `anchoring.guards.mjs` into `eslint.config.js`, which forbids imports of `node:fs`, `node:child_process`, and other impure primitives in the pure domain layer. Verified by unit tests in `src/invariants.test.ts`.
