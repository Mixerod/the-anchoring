---
id: INV-INJECTED-IO
title: Core modules receive I/O boundaries injected as arguments
status: active
enforced_by:
  - file:eslint.config.js
holds_for:
  - file:src/verify.ts
  - file:src/why.ts
  - file:src/ctx.ts
  - file:src/done.ts
  - file:src/render.ts
  - file:src/model.ts
---

# INV-INJECTED-IO: Core modules receive I/O boundaries injected as arguments

## Rule

Core logic modules (`verify.ts`, `why.ts`, `ctx.ts`, `done.ts`, `unclaimed.ts`, `render.ts`, `model.ts`) must remain pure functions over in-memory data structures. Git execution, codegraph symbol queries, clock reads, and filesystem I/O must reach the core as injected arguments or via dedicated I/O boundary modules (`git.ts`, `anchors.ts`, `frontmatter.ts`, `store.ts`, `session.ts`, `config.ts`, `init.ts`, `root.ts`).

## Enforcement

Enforced by ESLint rule `no-restricted-imports` in `eslint.config.js`, which forbids imports of `node:fs`, `fs`, `node:child_process`, and `child_process` in all core logic modules in `src/**/*.ts`. Verified by unit tests in `src/invariants.test.ts`.
