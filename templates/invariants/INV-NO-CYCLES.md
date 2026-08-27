---
id: INV-NO-CYCLES
title: The dependency graph is acyclic
status: active
enforced_by:
  - file:anchoring.depcruise.cjs
holds_for: []
---

# INV-NO-CYCLES: The dependency graph is acyclic

## Rule

The static module dependency graph must be a directed acyclic graph (DAG). Cycles between modules or files prevent isolated unit testing, obscure architectural ownership, and make ripple effects unpredictable when refactoring.

## Enforcement

Enforced by dependency-cruiser rule `no-circular` in `anchoring.depcruise.cjs`. Verified by CI on every pull request.
