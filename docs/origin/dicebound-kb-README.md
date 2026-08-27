# `.dicebound/` — the intent graph

What the code cannot say about itself: why it exists, whom it serves, who decided it, and
how it has broken before. `codegraph` owns structure; this directory owns meaning.

Built on 2026-08-22 in a change called **[The Anchoring](../docs/THE_ANCHORING.md)** — that
file states the pattern independently of this project, for reuse elsewhere.

Rationale and the full schema: [ADR-0013](../docs/adr/0013-knowledge-base-and-retrieval.md).
How to use it while working: [`.agent/rules/15-retrieval.md`](../.agent/rules/15-retrieval.md).

## Layout

| Directory | Kind | Id | Holds |
|---|---|---|---|
| `invariant/` | `INV` | `INV-CORE-PURITY` | rules that must always hold, **and the checker that enforces each one** |
| `flow/` | `FLOW` | `FLOW-0001` | how a user actually moves through a feature |
| `work/` | `W` | `W-112` | tasks — replaces Linear |
| `incident/` | `INC` | `INC-0007` | a bug that happened, its root cause, and the guard that now prevents it |

Decisions (`ADR-*`) stay in `docs/adr/`, where they already lived.

## Rules

Every document is one file, one entity, with YAML frontmatter carrying `id`, `title`,
`status`, and its links. One file per entity keeps branches from conflicting; no derived
field is ever written into a document.

Links to code are **anchors**, in two forms only:

```yaml
governs:
  - file:packages/core/src/tempo/costs.ts   # checked against the filesystem
  - sym:tempoCost                            # checked against the codegraph index
```

Line numbers are not an anchor form. They rot within a commit.

## Commands

```bash
pnpm kb ctx W-112              # before you start: everything that bears on this work
pnpm kb why <path|symbol|id>   # what this is for, and what depends on that answer
pnpm kb done W-112             # before you finish: what still needs recording
pnpm kb verify                 # re-test every claim these documents make about the code
```

`kb ctx` is tier 2 of progressive disclosure: it names the documents that apply and stops,
so you read three files instead of thirty. `kb done` reads `git diff` and reports the gaps —
it never asks you to remember anything, which is the only reason it works.

`pnpm verify` runs `kb verify`, so documentation that has drifted from the code fails the
build rather than quietly becoming fiction.
