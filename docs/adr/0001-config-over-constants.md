---
id: ADR-0001
title: Configurable paths and thresholds with fixed schema
status: accepted
governs:
  - file:src/config.ts
  - file:src/root.ts
constrains:
  - INV-CONFIG-THREADED
verified_by: []
supersedes: []
---

# ADR-0001: Configurable paths and thresholds with fixed schema

## Context

In the upstream codebase (`@dicebound/kb`), directory paths (`.dicebound/`, `docs/adr`), ID patterns, statuses, and hazard thresholds were hardcoded as module-level constants. To port the intent graph into a standalone package usable across different repositories, paths, file locations, ID regexes, status lists, and hazard thresholds must be configurable per repository via `anchoring.config.json`.

However, making the core graph schema (the six entity kinds: `ADR`, `INV`, `FLOW`, `WORK`, `INC`, `HAZ`, along with link fields, scalar fields, and edge semantics) dynamic or user-configurable would create unbounded complexity, dilute the intent graph's guarantees, and lead to incompatible dialects across repositories.

## Decision

1. Make repository paths (`kbRoot`, kind directories, `governedPaths`), ID validation patterns, status allowlists, and hazard thresholds configurable via `anchoring.config.json` at the repository root.
2. Keep the core schema (the six entity kinds, `LINK_FIELDS`, `SCALAR_FIELDS`, `EDGE_PHRASE`, `HAZARD_RESOLUTIONS`, and anchor forms `file:` / `sym:`) strictly hardcoded in `src/model.ts`.
3. Configuration is loaded once at the CLI boundary and passed down as an explicit parameter (`AnchoringConfig`), never stored in a module-level singleton (constraining `INV-CONFIG-THREADED`).

## Consequences

- Any repository can adopt the intent graph with custom directory structures or conventions without forking or patching the package.
- The schema semantics remain universal, machine-checkable, and predictable across all projects adopting The Anchoring.
- No dynamic schema interpretation overhead or drift.
