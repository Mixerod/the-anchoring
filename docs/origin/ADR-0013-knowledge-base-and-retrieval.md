---
id: ADR-0013
title: Knowledge lives in git as an intent graph; retrieval is agentic, not embedded
status: accepted
governs:
  - file:tools/kb/src
  - file:.dicebound
  - file:.agent/rules/15-retrieval.md
constrains:
  - INV-CORE-PURITY
verified_by:
  - file:tools/kb/src/verify.test.ts
  - file:tools/kb/src/why.test.ts
supersedes: []
---

# ADR-0013: Knowledge lives in git as an intent graph; retrieval is agentic, not embedded

- **Status:** Accepted
- **Date:** 2026-08-22
- **Known as:** **The Anchoring** — the portable form of this decision is
  [`docs/THE_ANCHORING.md`](../THE_ANCHORING.md). If someone asks to "apply The Anchoring"
  to another repository, that file is the whole brief; this ADR is the Dicebound-specific
  record.

## Context

Three kinds of project knowledge were being managed as if they were one thing:

| | Content | Nature | Size |
|---|---|---|---|
| **A** | Prose — rules, ADRs, reasoning, user workflows | Human-written, needs review | `docs/` ≈ 513 KB (~128K tokens) |
| **B** | Structure — what calls what, what breaks if this changes | **Derivable from code** | ~45 source files |
| **C** | Work state — tasks, phases, gates, ownership | Has a lifecycle | held in Linear |

Two problems followed from the conflation. First, no link existed between A and the code:
an agent could read ADR-0003 and read `costs.ts` and have no way to know they were about
the same thing. Second, C lived outside the repository, so work state and the commit that
satisfied it were never in the same place, and every agent needed network access and a
token to know what it was building.

The proposal on the table was a vector database over the documentation.

### Why not a vector database

The evidence points the other way, and it is not close:

- Anthropic shipped Claude Code with RAG plus a local vector DB and **removed it** in
  May 2025. Boris Cherny: *"agentic search generally works better. It is also simpler and
  doesn't have the same issues around security, privacy, staleness, and reliability."*
  Cursor, Windsurf, Cline, Devin and Sourcegraph Amp followed.
- *Is Grep All You Need?* (arXiv 2605.15184) measured grep against embedding retrieval
  across four harnesses and found grep more accurate; the harness mattered more than the
  retrieval method. Amazon Science (AAAI 2026) measured agentic keyword search at 94.5% of
  RAG faithfulness with no vector store at all.
- Anthropic's own *Contextual Retrieval* guidance: below ~200K tokens, put the corpus in
  the prompt and skip RAG entirely. This corpus is ~128K tokens. Further, of the measured
  67% reduction in retrieval failures there, contextual embeddings alone account for 35% —
  most of the value comes from BM25 and reranking, neither of which needs a vector.
- **Staleness is the decisive argument.** An index that silently disagrees with the code is
  worse than no index, because nothing reveals the disagreement. That failure mode is the
  same one this ADR exists to eliminate, so importing it would be self-defeating.

Multi-hop structural questions — *what breaks if I change this* — are answered by a
**graph**, not by similarity. Graph-guided retrieval lifts Recall@5 from 73.4% to 87.8% on
multi-hop benchmarks. `codegraph` already provides that graph, locally, for free.

## Decision

**1. Two graphs, joined by anchors.**

`codegraph` owns the *structural* graph — `CALLS`, `IMPORTS`, `USES_TYPE` — derived from
code, regenerated on demand, never hand-written. A new *intent* graph owns what code cannot
express: why something exists, whom it serves, who decided it, how it has broken before.

The join between them is an **anchor**, in exactly two forms:

```
file:packages/core/src/tempo/costs.ts    checked against the filesystem
sym:tempoCost                            checked against the codegraph index
```

Line numbers are not an anchor form and will not become one. They rot within a commit, and
a reference that silently becomes wrong is worse than no reference at all.

**2. Markdown in git is the source of truth. Any index is derived and disposable.**

A database cannot be reviewed in a pull request, cannot be merged, and does not travel with
a branch. Everything an agent must trust therefore lives in a `.md` file with YAML
frontmatter, versioned beside the code it describes. `tools/kb` re-reads the whole corpus on
every run — single-digit milliseconds at this size — so there is no cache to go stale.

**3. Five entity kinds.**

| Kind | Prefix | Location | Replaces |
|---|---|---|---|
| Decision | `ADR-` | `docs/adr/` | — (existing) |
| Invariant | `INV-` | `.dicebound/invariant/` | rules previously stated only in prose |
| Flow | `FLOW-` | `.dicebound/flow/` | nothing — user/UX workflows were undocumented |
| Work | `W-` | `.dicebound/work/` | **Linear** |
| Incident | `INC-` | `.dicebound/incident/` | nothing — bug fixes left no reusable record |

`INCIDENT` is deliberately separate from `DECISION`: an incident is an event that happened,
an ADR is a decision that stops it happening again. An incident may be `promoted_to` an ADR,
or may end where it is. Forcing every bug into an ADR would dilute `docs/adr/` within weeks.

**4. Retrieval is progressive disclosure, matching Anthropic's Agent Skills pattern.**

Frontmatter is tier 1 — enough for an agent to know what exists without reading anything.
`kb ctx` will be tier 2 and the document bodies tier 3. Retrieval quality comes from
frontmatter being rich enough to route on, not from an embedding model.

**5. Every claim is machine-checked.**

`kb verify` re-tests every anchor and every reference on each run. An invariant that matters
is enforced by a program, not described in a paragraph — the same principle already applied
to core purity by eslint and `.githooks/guard.sh`.

**6. Linear is retired** once `.dicebound/work/` exists (see Consequences).

## Consequences

**Gained.** Work state ships in the same commit as the code that satisfies it. Agents need
no network, no token, and no external account. Documentation that drifts from code fails
`pnpm verify` instead of quietly becoming fiction. `kb why <file>` answers the question
`codegraph` structurally cannot.

**Lost.** Linear's notifications, mobile access, and visibility for anyone not using a
terminal. Accepted deliberately: this is a single-maintainer project.

**Costs.** `.dicebound/work/` will conflict when two branches touch one item — mitigated by
one file per item and by never storing a derived field in a document. Symbol anchors are
unverifiable until `codegraph init` has run; `kb verify` reports these as warnings, and
`--strict` (for CI) escalates them to errors.

**Named.** This change is called **The Anchoring**, after the anchor — the machine-checkable
tie between a claim and the code it is about, which is the one invention everything else
here follows from. The name exists so it can be reused: `docs/THE_ANCHORING.md` states the
pattern independently of this project.

**Deferred, with a trigger rather than a feeling.** A persistent SQLite index with FTS5,
and eventually `sqlite-vec` for hybrid retrieval, are introduced only when all three hold:
`docs/` exceeds ~300K tokens; logged `kb search` queries show measurable lexical misses; and
those misses cause real harm. `kb search` must log every query from the day it exists, so
that decision is made from data. Packaging `kb` for other projects is deferred until it has
survived at least one full phase of use here.

**One-time guard collision.** Stamping frontmatter onto ADR-0001 … ADR-0012 modifies files
that `.githooks/guard.sh` marks append-only. The guard is correct to stop it and must not be
routed around; the migration requires a deliberate human override, recorded here. No
decision text was changed — the edits add frontmatter only.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Vector DB over `docs/` | Corpus is below Anthropic's own no-RAG threshold; adds staleness, the exact failure being designed out |
| Keep Linear, add links | Two sources of truth for work state; they drift, and the drift is invisible |
| Hand-written dependency docs | Duplicates what `codegraph` derives, and is wrong the moment code moves |
| Store the intent graph in SQLite | Not reviewable in a PR, not mergeable, does not travel with a branch |
| Line-number anchors | Rot within one commit |

## References

- [Contextual Retrieval in AI Systems — Anthropic](https://www.anthropic.com/engineering/contextual-retrieval)
- [Agent Skills — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Is Grep All You Need? How Agent Harnesses Reshape Agentic Search — arXiv 2605.15184](https://arxiv.org/abs/2605.15184)
- [Codebase-Memory: Tree-Sitter Knowledge Graphs for LLM Code Exploration via MCP — arXiv 2603.27277](https://arxiv.org/html/2603.27277v1)
- [Building Claude Code with Boris Cherny — The Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
