---
id: INV-MODULE-ENTRY
title: Cross-module imports go through the module's entry point
status: active
enforced_by:
  - file:anchoring.depcruise.cjs
holds_for: []
---

# INV-MODULE-ENTRY: Cross-module imports go through the module's entry point

## Rule

Files outside a module root must only import symbols exported from the module's designated entry points (e.g. `index.ts`). Deep imports into module internals bypass encapsulation and turn internal refactors into breaking changes.

## Enforcement

Enforced by dependency-cruiser `module-<root>-entry-only` rules in `anchoring.depcruise.cjs`.
