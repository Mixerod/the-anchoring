---
id: ADR-0004
title: Split pure domain graph operations from infra filesystem loaders
status: accepted
owner: "@Mixerod"
governs:
  - file:src/store.ts
  - file:src/loader.ts
  - file:src/anchors.ts
  - file:src/resolver.ts
  - file:src/config.ts
  - file:src/root.ts
  - file:src/ask.ts
constrains:
  - INV-PURE-CORE
  - INV-DEP-DIRECTION
verified_by: []
supersedes: []
---

# ADR-0004: Split pure domain graph operations from infra filesystem loaders

## Context

Layer 3 introduces the `pure: true` constraint for the domain layer (`INV-PURE-CORE`), which prohibits impure imports (`node:fs`, `node:child_process`, `node:crypto`, `node:worker_threads`) and non-deterministic global lookups (`Date.now()`, `Math.random()`, `fetch`).

Previously, `src/store.ts`, `src/anchors.ts`, `src/frontmatter.ts`, and `src/config.ts` combined pure parsing and verification logic with direct filesystem calls (`readdirSync`, `statSync`, `readFileSync`, `existsSync`) and shell execution (`spawnSync`).

## Decision

1. **Pure Domain (`src/store.ts`, `src/anchors.ts`, `src/frontmatter.ts`, `src/config.ts`)**:
   - `store.ts` defines `Entity`, `Store`, `LoadProblem` models and pure `parseEntity` / `buildStore`.
   - `frontmatter.ts` provides pure `parseFrontmatter` and `toList`.
   - `anchors.ts` defines `Anchor` types, pure `parseAnchor`, and pure `checkAnchors`.
   - `config.ts` provides pure config types and `parseConfig`.

2. **Infra Layer (`src/loader.ts`, `src/resolver.ts`, `src/root.ts`)**:
   - `loader.ts` performs directory traversal and file reading (`readFrontmatter`, `readEntity`, `loadStore`).
   - `resolver.ts` performs filesystem and `codegraph` symbol probes (`createResolver`, `hasCodegraphIndex`, `codegraphProbe`).
   - `root.ts` locates repository roots and loads `anchoring.config.json` (`findRepoRoot`, `loadConfig`).

3. **Dependency Direction**:
   - `cli` → `app` → `domain` → `infra`.
   - Domain logic imports loaders from `infra` when needed without performing I/O directly, preserving purity while maintaining clear separation of concerns.

## Consequences

- The domain layer is 100% pure and can be unit tested without filesystem fixtures or process mocks.
- `anchoring.guards.mjs` and `anchoring.depcruise.cjs` cleanly enforce purity and dependency direction across the repository.
