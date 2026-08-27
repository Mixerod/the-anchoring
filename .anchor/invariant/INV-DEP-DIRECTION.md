---
id: INV-DEP-DIRECTION
title: Dependencies point one way, down the layer order
status: active
owner: "@Mixerod"
enforced_by:
  - file:anchoring.depcruise.cjs
  - file:anchoring.config.json
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

# INV-DEP-DIRECTION: Dependencies point one way, down the layer order

## Rule

Layered architecture exists to bound the cost of change: changes to outer layers (CLI, App) cannot break inner layers (Domain, Infra), and domain logic remains isolated from presentation and orchestration.

A layer may only import from itself and from any layer declared below it in the configured layer order. Importing upward is strictly forbidden.

## Enforcement

Enforced by `dependency-cruiser` direction rules generated from `anchoring.config.json` into `anchoring.depcruise.cjs` and composed into `.dependency-cruiser.cjs`.
