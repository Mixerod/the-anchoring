# `.anchor/` — the intent graph

What the code cannot say about itself: why it exists, whom it serves, who decided it, and
how it has broken before. A structural index owns structure; this directory owns meaning.

Built on the pattern described in **The Anchoring** (`docs/THE_ANCHORING.md`).

## Layout

| Directory | Kind | Id | Holds |
|---|---|---|---|
| `invariant/` | `INV` | `INV-RULE-NAME` | rules that must always hold, **and the checker that enforces each one** |
| `flow/` | `FLOW` | `FLOW-0001` | how a user actually moves through a feature |
| `work/` | `W` | `W-1` | tasks |
| `incident/` | `INC` | `INC-0001` | a bug that happened, its root cause, and the guard that now prevents it |
| `hazard/` | `HAZ` | `HAZ-0001` | an external failure mode that could recur here |
| `session/` | — | — | disposable session state (gitignored) |

Decisions (`ADR-*`) live in the configured ADR directory (default `docs/adr/`).

## Rules

Every document is one file, one entity, with YAML frontmatter carrying `id`, `title`,
`status`, and its links. One file per entity keeps branches from conflicting; no derived
field is ever written into a document.

Links to code are **anchors**, in two forms only:

```yaml
governs:
  - file:src/costs.ts       # checked against the filesystem
  - sym:calculateCost       # checked against the structural index
```

Line numbers are not an anchor form. They rot within a commit.

## Commands

```bash
npx kb ctx <W-id>              # before you start: progressive context
npx kb why <path|symbol|id>    # what this is for, and what depends on that answer
npx kb done <W-id>             # before you finish: what still needs recording
npx kb verify                  # re-test every claim these documents make about the code
```
