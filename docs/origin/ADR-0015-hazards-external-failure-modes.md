---
id: ADR-0015
title: Hazards - external failure modes as a checked entity kind
status: accepted
governs:
  - file:.dicebound/hazard
  - file:tools/kb/src/model.ts
verified_by:
  - file:tools/kb/src/verify.test.ts
constrains: []
supersedes: []
---

# ADR-0015: Hazards - external failure modes as a checked entity kind

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** @Mixerod
- **Known as:** **Slice 4 of The Anchoring**

## Context

The Dicebound knowledge base defines five entity kinds: `ADR-`, `INV-`, `FLOW-`, `W-`, and `INC-` (ADR-0013).

There is a distinct category of project knowledge that none of these five kinds can hold: **failure modes that actually occurred in other production systems, whose underlying mechanisms could reproduce in this repository**.

A living example is ADR-0014: it was written directly because of [BIP-50](https://github.com/bitcoin/bips/blob/master/bip-0050.mediawiki) (Bitcoin March 2013), where an unstated implementation limit became an accidental consensus rule and caused a fork upon upgrade. That external war story exposed a genuine defect in Dicebound's ruleset replay determinism (where draw rules were hardcoded rather than parameterized in `Ruleset`). Yet BIP-50 existed nowhere in the repository's structured intent graph; it lived only in the ephemeral memory of a single working session.

Existing kinds cannot hold this knowledge:
- `INC-` (Incident) represents events that **have already occurred here**. A hazard has not happened here yet.
- `INV-` (Invariant) defines active invariants that code and checkers must obey; a raw failure mode is not an invariant until a mitigation rule is designed.
- `ADR-` (Decision) records architectural choices made for this repository; an external outage is an observation, not a decision.

Without a dedicated entity kind, external failure mode knowledge is lost between sessions or degrades into unstructured tribal folklore.

## Decision

Define the sixth entity kind, `HAZ-` (Hazard), stored in `.dicebound/hazard/` with identifier format `HAZ-NNNN`.

A hazard records a documented external failure mode, maps its mechanism to concrete files in this repository via anchors, and tracks its resolution to ensure it either converts into an enforced invariant or is explicitly accepted/dismissed.

### Three Load-Bearing Constraints

To prevent hazards from decaying into speculative paranoia or an unread wiki, three mandatory constraints are enforced by `tools/kb`:

1. **Mandatory `source:`** — Every hazard must supply a verifiable public URL and date. An entry without a source is rejected by `kb verify`.
   - *Rationale:* An unverifiable war story cannot be distinguished from vague paranoia. If an event cannot be cited, it does not enter the knowledge base.
2. **Mandatory `resolution:`** — Every hazard must define its status as one of:
   - `guarded` (must specify `resolves_to: INV-*`)
   - `accepted` (must specify `reason`)
   - `not-applicable` (must specify `reason`)
   - `open`
   **An `open` status older than 30 days causes `kb verify --strict` (CI gate) to FAIL.**
   - *Rationale:* This turns war stories into active checkers. A hazard is not permitted to sit indefinitely in an unaddressed state of perpetual concern.
3. **Hard ceiling of 24 entries.**
   - *Rationale:* An unbounded catalog becomes a documentation graveyard, and nobody reads a graveyard. Adding a 25th entry requires resolving an existing hazard into an `INV-`, dismissing it, or pruning it.

### Retrieval via Anchor Set Intersection

Hazards are activated deterministically through **anchor set intersection**, never through probabilistic model memory or runtime guessing:
- `kb ctx W-<n>` intersects the `touches:` anchors of the active work item with `holds_for:` anchors of `HAZ-*`.
- `kb why <file>` surfaces hazards anchored to the target file.
- The `kb done` stop hook intersects modified files from `git diff` against `HAZ-*` anchors.
- Maximum 3 hazards are presented per retrieval context to conserve agent attention.

Only `file:` anchors are used (`file:<path>`). Because `codegraph init` has not run across all environments, `sym:` anchors cannot yet be verified for hazards.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Catalog of common language-level errors** (e.g. null dereference, off-by-one, floating-point equality, unhandled promise rejections) | **These errors already have owners.** Strict TypeScript (`tsconfig`), eslint rules, and automated reviewer linters catch them on every build. Adding them to `kb` duplicates an existing toolchain and degenerates `HAZ-` into an academic textbook instead of repository-specific constraints. **`HAZ-` only contains failure modes that no off-the-shelf checker catches.** |
| Add to `INC-` with `origin: external` | Blurs the boundary between "broke here" and "could break here", corrupting incident postmortem metrics and audit trails. |
| Record in `docs/adr/` | A hazard is an external event/mechanism, not an architectural decision. Dilutes ADRs with non-decisions. |
| Do nothing; rely on model training memory | Current state. BIP-50 proved that relying on memory loses critical failure modes across sessions. |

## Consequences

**Gained:**
- High-severity failure modes proven in other distributed, deterministic, or game systems (like BIP-50) are retained as machine-checked context.
- Agents touching sensitive subsystems (e.g., ruleset determinism, tempo math, replay verification) are warned of specific external disasters before making equivalent mistakes.
- A forced 30-day resolution deadline ensures risks are either engineered out into `INV-` or explicitly accepted.

**Lost / Accepted costs:**
- Maintenance overhead of `.dicebound/hazard/` and the 24-item quota discipline.
- CI will fail on unresolved `open` hazards exceeding 30 days, requiring active triage.

**Reversal cost:**
- Low. If retired, removing `HAZ-` requires deleting `.dicebound/hazard/` and removing the schema entry in `tools/kb/src/model.ts`.

**Positioning:**
- This is **Slice 4 of The Anchoring** (an extension of the intent graph defined in ADR-0013), not a second brand or divergent framework.

## References

- [BIP-50: March 2013 Chain Fork Post-Mortem — Bitcoin BIPs](https://github.com/bitcoin/bips/blob/master/bip-0050.mediawiki)
- [SEC Release No. 34-70694: In the Matter of Knight Capital Americas LLC — U.S. Securities and Exchange Commission (October 2013)](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf)
- [The Vancouver Stock Exchange Index Round-off Error — University of Toronto CS / Risk Analysis (1983)](https://www.cs.toronto.edu/~fun/vancouver.html)
