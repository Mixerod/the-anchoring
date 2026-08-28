# Module Boundaries

Structure between modules and long-term maintainability.

## Principles

1. **The dependency matrix is written down.** `README.md`, `docs/architecture/`, or the linter config must state which layer may import which. An import against the stated direction fails review. Without a written matrix, "correct structure" is unfalsifiable and every later argument is taste.

2. **Dependencies point one way. No cycles.** A lower layer never imports a higher one. If a low-level module seems to need something from above, pass the value in as an argument (`INV-DEP-DIRECTION`, `INV-NO-CYCLES`).

3. **Cross-module imports go through the module's public entry point.** `index.ts`, `__init__.py`, the package API. Importing another module's internal file is a boundary violation (`INV-MODULE-ENTRY`).

4. **A boundary checker runs in CI, and CI fails on violation.** Use ecosystem tools (`dependency-cruiser`, `eslint-plugin-boundaries`, `ArchUnit`, `Packwerk`, `import-linter`). Set it up with the first module, not after it hurts.

5. **I/O and external SDKs stay out of the domain core.** Database drivers, HTTP clients, filesystem, clocks, and randomness are injected as arguments or interfaces, never imported by domain logic (`INV-PURE-CORE`).

6. **A module owns its data.** No other module reads its tables, its ORM entities, or its internal records directly — it asks through the public API.

7. **UI, controllers, and event handlers only move data.** Business logic — calculation, state transitions, validation — lives in the domain layer, reachable by a test, a CLI, a background job, or an AI without going through a click handler.

8. **Split on "two reasons to change", not on line count.** Line count is a lagging indicator. The leading indicator: two groups of functions that share no state and no imports and change for different reasons. Split then.

9. **One concept, one name, everywhere.** The same noun in database, types, API contract, UI, tests, and docs.
