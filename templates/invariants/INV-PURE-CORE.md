---
id: INV-PURE-CORE
title: The pure layer performs no I/O; every non-deterministic input is an argument
status: active
enforced_by:
  - file:anchoring.guards.mjs
holds_for: []
---

# INV-PURE-CORE: The pure layer performs no I/O; every non-deterministic input is an argument

## Rule

Modules in the pure layer must contain only deterministic domain logic. Direct filesystem access, network requests, child process execution, global date/clock access, and random number generation are strictly forbidden. All external state and non-deterministic values must be passed in as arguments.

## Enforcement

Enforced by ESLint rules `no-restricted-imports`, `no-restricted-globals`, and `no-restricted-properties` in `anchoring.guards.mjs`.
