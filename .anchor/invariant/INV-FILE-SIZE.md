---
id: INV-FILE-SIZE
title: Files and functions stay bounded within human and LLM context limits
status: active
owner: "@Mixerod"
enforced_by:
  - file:anchoring.guards.mjs
holds_for:
  - file:src/cli.ts
  - file:src/render.ts
  - file:src/init.ts
  - file:src/agents.ts
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
  - file:src/root.ts
  - file:src/git.ts
  - file:src/loader.ts
  - file:src/resolver.ts
  - file:src/session.ts
---

# INV-FILE-SIZE: Files and functions stay bounded within human and LLM context limits

## Rule

Files over 400 lines and functions over 50 lines exhaust single-prompt attention budgets, obscure responsibilities, and accumulate unrelated reasons to change.

Every source file must remain strictly under 400 lines (excluding blank lines and comments), and every function under 50 lines.

## Enforcement

Enforced by ESLint rules `max-lines` and `max-lines-per-function` generated in `anchoring.guards.mjs` and composed into `eslint.config.js`.
