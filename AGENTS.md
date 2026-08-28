# AGENTS.md

Instructions for autonomous AI agents working in this repository.

## 1. Cold start
Before answering, planning, or editing: run `kb ctx W-<n>` for the work item. If you were not given one, ask for it or open one. There is no small-change exemption.

## 2. Retrieval
When no work item exists yet, run `kb ask "<question>"` to find relevant decisions, invariants, and prior incidents. Before reading files by hand, run `kb why <file|symbol>`. Read what it names and stop there.

## 3. While working
Keep `touches:` current in the work item as you learn what the change reaches. Never write a derived field into a document.

## 4. Before declaring done
`kb done <W-id>` must be clean, `kb verify` must pass, and any `INV-` reachable from the work must still hold. Report failures with their output; never assert that something passed.

## 5. Architecture rules
<!-- kb:architecture:start -->
### Layer Order

```
cli
  ↓
app
  ↓
domain (pure)
  ↓
infra
```

- Dependencies point one way, down the layer order. Importing upward is forbidden (`INV-DEP-DIRECTION`).
- The dependency graph must remain acyclic (`INV-NO-CYCLES`).

### Enforced Invariants

- The pure layer (`domain`) performs no I/O; every non-deterministic input is an argument (`INV-PURE-CORE`).
- Files must stay under 400 lines and functions under 50 lines (`INV-FILE-SIZE`).

### Non-Machine-Checked Principles
- **UI and controllers only move data**: No domain logic in presentation, UI components, or routing.
- **One concept, one name, everywhere**: Use consistent domain terminology across types, doc comments, and UI.
- **Split on two reasons to change, not on line count**: Organize by cohesion and single responsibility, not by arbitrary line counts.
<!-- kb:architecture:end -->

## 6. Never do these
- Edit a generated `anchoring.*` file.
- Loosen a threshold to make a check pass.
- Add a dependency to the pure layer.
- Record a work item as done with gaps outstanding.
