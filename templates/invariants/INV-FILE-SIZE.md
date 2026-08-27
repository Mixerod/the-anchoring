---
id: INV-FILE-SIZE
title: Files and functions stay under the configured ceiling
status: active
enforced_by:
  - file:anchoring.guards.mjs
holds_for: []
---

# INV-FILE-SIZE: Files and functions stay under the configured ceiling

## Rule

Source files and functions must not exceed the maximum line counts declared in `anchoring.config.json`. File and function length ceilings serve as a lagging indicator for missing modular boundaries and multiple reasons to change.

## Enforcement

Enforced by ESLint rules `max-lines` and `max-lines-per-function` in `anchoring.guards.mjs`.
