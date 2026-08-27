---
id: INV-MODULE-ENTRY
title: Cross-module imports go through entry points only
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

# INV-MODULE-ENTRY: Cross-module imports go through entry points only

## Rule

Reaching into a module's internals turns internal implementation details into public API, making safe refactoring impossible.

Cross-module imports must target the declared module entry points (`index.ts`, `index.js`, etc.) rather than deep internal files.

## Enforcement

Enforced by `dependency-cruiser` rule `INV-MODULE-ENTRY` in `anchoring.depcruise.cjs` and composed into `.dependency-cruiser.cjs`.
