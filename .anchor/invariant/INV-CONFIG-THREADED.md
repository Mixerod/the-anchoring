---
id: INV-CONFIG-THREADED
title: Configuration is threaded as a parameter, never a module-level singleton
status: active
enforced_by:
  - file:eslint.config.js
holds_for:
  - file:src/config.ts
  - file:src/cli.ts
---

# INV-CONFIG-THREADED: Configuration is threaded as a parameter, never a module-level singleton

## Rule

Configuration is loaded exactly once at the application boundary (`src/cli.ts`) and passed explicitly down the call stack as a parameter (`AnchoringConfig`). There must never be a module-level mutable singleton `let config` or global state in any module.

## Enforcement

Enforced by ESLint rule `no-restricted-syntax` in `eslint.config.js`, which forbids top-level mutable variable declarations named `config` across all files in `src/**`. Verified by unit tests in `src/invariants.test.ts`.
