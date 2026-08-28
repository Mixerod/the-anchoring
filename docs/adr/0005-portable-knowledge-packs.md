---
id: ADR-0005
title: Portable knowledge packs for cross-repository engineering doctrine
status: accepted
owner: "@Mixerod"
governs:
  - file:src/pack.ts
  - file:src/pack-source.ts
  - file:src/cli-pack.ts
  - file:src/pack.test.ts
  - file:scripts/anchoring-scan-secrets.mjs
  - file:templates/packs/discipline/
constrains:
  - INV-PURE-CORE
  - INV-DEP-DIRECTION
verified_by: []
supersedes: []
---

# ADR-0005: Portable knowledge packs for cross-repository engineering doctrine

## Context

Layer 3 anchored local repository intent, where every anchor is `file:src/...`. However, engineering judgment and lessons learned in one repository must be portable across projects.

Previous seeding mechanisms were hardcoded (`kb init --guards`) and hazards (`HAZ-`) had no standard cross-repository transport.

## Decision

1. **Pack Structure**: A pack is a directory containing `pack.json`, `invariant/`, `hazard/`, and `doctrine/`.
2. **Pure Planner & Drift Check**: `planPack` and `checkPack` are pure domain functions (`src/pack.ts`). File hashing uses canonical FNV-1a to differentiate between `stale` (pack updated) and `hand-edited` (local modifications).
3. **No Seventh Kind**: `.anchor/doctrine/` contains non-machine-checked prose files; it is intentionally ignored by `loadStore` and `kb verify`.
4. **Resolution Hierarchy**: Built-in (`templates/packs/`), environment variable (`ANCHORING_PACKS`), and default user directory (`~/.anchoring/packs/`). Duplicate pack names across distinct paths produce an error rather than silent shadowing.

## Consequences

- Portable engineering discipline can be seeded into any repository via `kb pack add <name>` or `kb init --pack <name>`.
- `kb why templates/packs/discipline/` resolves to this decision.
