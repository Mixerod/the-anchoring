---
id: ADR-0003
title: Split initialization planning from application in kb init
status: accepted
governs:
  - file:src/init.ts
constrains: []
verified_by: []
supersedes: []
---

# ADR-0003: Split initialization planning from application in kb init

## Context

Bootstrapping the intent graph (`kb init`) into a repository involves probing existing repository structures (such as ADR directories, source directories, `.codegraph` indexes), computing default configuration, creating directory skeletons with `.gitkeep` files, generating template documents, and updating `.gitignore`.

If planning and filesystem writes are interleaved in a single procedure:
- Testing requires creating and cleaning up complex real filesystem fixtures for every permutation.
- Supporting `--dry-run` requires adding conditional flags and checks throughout the execution path, creating two separate code paths that can drift.
- Failure during write operations can leave partial, non-deterministic state.

## Decision

Split initialization into two distinct, pure/injected phases:
1. `planInit(root, options, probe)`: inspects the environment through an injected `FsProbe` function and computes an immutable `InitPlan` containing all directories to create, files to write, and diagnostic notes.
2. `applyInit(plan, io)`: takes the computed `InitPlan` and writes files/directories using an injected `InitIo` interface.

## Consequences

- `planInit` is 100% testable in-memory without any disk I/O.
- `--dry-run` is simply calling `planInit` and formatting the plan output without calling `applyInit`.
- Filesystem writes are atomic, deterministic, and isolated to `applyInit`.
