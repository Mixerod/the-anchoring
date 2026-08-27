---
id: INV-DEP-DIRECTION
title: Dependencies point one way, down the layer order
status: active
enforced_by:
  - file:anchoring.depcruise.cjs
  - file:anchoring.config.json
holds_for: []
---

# INV-DEP-DIRECTION: Dependencies point one way, down the layer order

## Rule

Dependencies must strictly follow the architectural layer order declared in `anchoring.config.json`. A layer may import from itself and from any layer below it. A lower layer must never import from a higher layer.

## Enforcement

Enforced by dependency-cruiser per-pair layer rules in `anchoring.depcruise.cjs` generated from the `architecture` matrix in `anchoring.config.json`.
