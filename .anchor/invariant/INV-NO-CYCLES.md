---
id: INV-NO-CYCLES
title: Dependency graph must remain acyclic
status: active
owner: "@Mixerod"
enforced_by:
  - file:anchoring.depcruise.cjs
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

# INV-NO-CYCLES: Dependency graph must remain acyclic

## Rule

Cycles make code impossible to reason about in isolation, impossible to test in layers, and impossible to extract into standalone packages. Every cycle is a failure of boundary definition.

Dependencies across the codebase must form a directed acyclic graph (DAG).

## Enforcement

Enforced by `dependency-cruiser` rule `no-circular` generated in `anchoring.depcruise.cjs` and composed into `.dependency-cruiser.cjs`.
