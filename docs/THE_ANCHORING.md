# The Anchoring

**A portable pattern for making a repository legible to agents.** First applied to
Dicebound on 2026-08-22/23. Written so it can be handed to a different project without
re-deriving the reasoning.

> If someone says *"apply The Anchoring to this repo"*, this file is the whole brief.

---

## The name

Documentation floats free of code. It is written once, drifts within weeks, and nothing
ever notices. **Anchoring** is the act of tying every claim a document makes to a specific,
machine-checkable point in the code — so that when the code moves, the claim fails loudly
instead of quietly becoming fiction.

The anchor is the load-bearing invention. Everything else follows from it.

---

## The problem it solves

An agent working in a repository has three questions, and only one of them has a good
answer by default:

| Question | Answered by | Before The Anchoring |
|---|---|---|
| *Where is this code, what calls it?* | a structural index (`codegraph`, LSP, tree-sitter) | fine |
| *Why does this exist, whom does it serve?* | **nothing** | guesswork |
| *What am I building, and is it recorded?* | an external tracker | offline, tokenised, drifts |

The second question is unanswerable from code, because the answer is not in the code. The
third is answerable but the answer lives somewhere the commit cannot reach.

## What it is not

Not a vector database, and deliberately so.

- Anthropic shipped Claude Code with RAG plus a local vector DB and **removed it** in
  May 2025 — agentic search (grep/glob/read) beat it, with fewer problems around
  *security, privacy, staleness, and reliability*. Cursor, Windsurf, Cline, Devin and
  Sourcegraph Amp followed.
- *Is Grep All You Need?* (arXiv 2605.15184) measured grep as more accurate than embedding
  retrieval across four harnesses; the harness mattered more than the retrieval method.
- Anthropic's own Contextual Retrieval guidance: **below ~200K tokens, skip RAG** and put
  the corpus in the prompt. Most repositories' prose is far below that.
- Of the 67% reduction in retrieval failures that Contextual Retrieval reports, contextual
  embeddings alone account for 35% — most of the value is BM25 and reranking, neither of
  which needs a vector.

**Staleness is the decisive argument.** An index that silently disagrees with the code is
worse than no index, because nothing reveals the disagreement. Importing that failure mode
to fix a drift problem would be self-defeating.

---

## The pattern

### 1. Two graphs, joined by anchors

| | Structural graph | Intent graph |
|---|---|---|
| Owns | `CALLS`, `IMPORTS`, `USES_TYPE` | why, whom for, who decided, how it broke |
| Source | derived from code | written by people, reviewed in PRs |
| Tool | `codegraph`, Serena, an LSP | this pattern |
| Regenerate | any time, from code | never — it is authored |

The join is an **anchor**, in exactly two forms:

```
file:packages/core/src/tempo/costs.ts    checked against the filesystem
sym:tempoCost                            checked against the structural index
```

**Line numbers are not an anchor form.** They rot within one commit, and a reference that
silently becomes wrong is worse than no reference.

### 2. Markdown in git is the source of truth

A database cannot be reviewed in a pull request, cannot be merged, and does not travel with
a branch. Everything an agent must trust lives in a `.md` file with YAML frontmatter,
beside the code it describes.

Re-read the whole corpus on every command. At the scale of a normal repository this is
single-digit milliseconds, and no cache means no staleness. Add a persistent index only
when a measurement demands it — see *Deferred*, below.

### 3. Six entity kinds

| Kind | Prefix | Holds | Replaces |
|---|---|---|---|
| Decision | `ADR-` | why a choice was made, and what it binds | existing ADRs |
| Invariant | `INV-` | a rule that must always hold, **plus its checker** | rules stated only in prose |
| Flow | `FLOW-` | how a user actually moves through a feature | usually nothing |
| Work | `W-` | a task | Jira / Linear / GitHub Issues |
| Incident | `INC-` | a bug, its root cause, and the guard that now prevents it | usually nothing |
| Hazard | `HAZ-` | a failure mode that has happened **elsewhere**, whose mechanism this repo could reproduce | war stories that lived only in one session's memory |

`INCIDENT` stays separate from `DECISION` on purpose: an incident is an event that
happened; an ADR is a decision that stops it happening again. An incident may be
`promoted_to` an ADR, or may end where it is. Forcing every bug into an ADR dilutes the
decision record within weeks.

The three-way boundary is clean: `HAZ-` could break here and has broken elsewhere; `INC-` has broken here; `INV-` is the rule that stops either breaking again. Three constraints keep `HAZ-` from degrading into an unread wishlist: a mandatory `source:` (public URL + date — no source is hearsay and fails verify); a mandatory `resolution:` (`guarded` | `accepted` | `not-applicable` | `open`, where `open` older than 30 days fails `kb verify --strict`); and a hard ceiling of 24 entries (the 25th must promote an existing hazard to an `INV-`). A hazard is surfaced purely by anchor intersection (`holds_for` intersecting a work item's `touches` or `git diff`), never by model judgment, capped at 3 items per retrieval.

Edges, deliberately few — each must have a real consumer:

```
WORK ─implements→ ADR|FLOW      WORK ─touches→   <anchor>
WORK ─closes→     INC           ADR  ─governs→   <anchor>
INC  ─violates→   INV           INV  ─enforced_by→ <anchor: test|lint|ci>
INC  ─promoted_to→ ADR          FLOW ─served_by→ <anchor>
ADR  ─supersedes→ ADR           WORK ─blocked_by→ WORK
ADR  ─constrains→ INV
HAZ  ─holds_for→  <anchor>      HAZ  ─resolves_to→ INV
```

### 4. Retrieval is progressive disclosure

The same three-tier shape as Anthropic's Agent Skills, applied to a repository:

| Tier | Loads | When |
|---|---|---|
| 1 | frontmatter — id, title, status, links | always; cheap enough to be free |
| 2 | `kb ctx <work-id>` — the documents that apply, named but not pasted | before starting |
| 3 | the document bodies, and the code | only what tier 2 named |

Retrieval quality comes from frontmatter being rich enough to route on. Not from an
embedding model.

### 5. Every claim is machine-checked

An invariant that matters is enforced by a program, not described in a paragraph. Prose is
followed roughly 70% of the time — fine for style, useless for an invariant.

---

## The four commands

| Command | Answers | Run by |
|---|---|---|
| `kb ctx <W-id>` | everything that bears on this work | the agent, before starting |
| `kb why <path\|symbol\|id>` | what this is for, and what depends on that | anyone, any time |
| `kb done <W-id>` | what still needs recording | the agent, before finishing |
| `kb verify [--strict]` | is any of this still true | CI, pre-commit, `verify` |

`kb why` is the payoff query. Given one file it returns the decision that governs it, the
user flow it serves, the work that touched it, and any incident that happened there — the
question a structural index structurally cannot answer.

`kb done` is the one that makes the pattern survive. It does **not** ask the agent to
remember anything: it reads `git diff`, compares it to what the intent graph claims, and
names each gap with the file to edit and the line to add.

---

## The three gates

| Gate | Runs | Behaviour | Why that behaviour |
|---|---|---|---|
| Stop hook | end of every agent turn | `kb done --check` — reports, **never fails the turn**; silent when no work item is open | a gate that blocks on bookkeeping is switched off within a week |
| pre-commit | before each commit | `kb verify` — no `--strict` | a missing structural index should warn locally, not block |
| CI | every PR | `kb verify --strict` | the only gate that cannot be bypassed with `--no-verify` |

The Stop hook must be fast (~150ms) and must never call an LLM. It runs hundreds of times a
day; anything slower is paid hundreds of times a day.

It knows which work item to ask about because `kb ctx` — which the agent runs before
starting anyway — leaves a note in a gitignored session file.

---

## Applying it to a new repository

Four slices. Each is usable on its own; none blocks on the next.

**Slice 1 — the core.** Frontmatter schema, `kb verify`, `kb why`. Stamp frontmatter onto
whatever decision records already exist, with `file:` anchors only. Goal: prove anchors
resolve and do not drift. If this slice is awkward, the pattern is wrong for that repo and
you have spent a day, not a month.

**Slice 2 — the lifecycle.** `W-` and `INC-` entities, `kb ctx`, `kb done`, migrate the
issue tracker. One file per work item — never a single `tasks.json`, which conflicts on
every branch. Never write a derived field into a document.

**Slice 3 — enforcement.** The three gates, plus the `FLOW-` documents nobody has written
yet.

**Slice 4 — the hazards.** `HAZ-` documents: failure modes that happened elsewhere and
could recur here. Do this one last, and only after slices 1-3 have survived real use —
it is the slice most likely to degrade into a wishlist. The three constraints above
(mandatory source, mandatory resolution with a 30-day clock on `open`, a hard ceiling)
are what keep it a checker instead of a reading list. Start with exactly three hazards.
If three cannot produce a real checker between them, the idea is wrong and it cost a day.

### Rules that are not optional

1. **Anchors are symbol- or file-level, never line-level.**
2. **`kb verify` runs in CI and CI fails on violation.** Without this the whole thing
   degrades into markdown that lies, within about six weeks.
3. **An `INV-` without a checker in `enforced_by` is a wish.** Write the lint rule, the
   test, or the CI job in the same commit.
4. **Migrate status honestly.** If the old tracker's statuses were stale, carry them across
   unchanged and create one reconciliation task. Inventing a status replaces one wrong
   record with a differently wrong record.
5. **Only source code is chased for "nobody explained this".** Use an allowlist
   (`packages/`, `apps/`, `src/`), not a denylist — otherwise every new config file
   reappears as a false finding and the check gets ignored.

---

## Deferred, with a trigger rather than a feeling

A persistent SQLite index with FTS5, and eventually `sqlite-vec` for hybrid retrieval, are
introduced only when **all three** hold:

1. the prose corpus exceeds ~300K tokens, **and**
2. logged `kb search` queries show measurable lexical misses, **and**
3. those misses cause real harm

Which means `kb search` must log every query from the day it exists. That turns "do we need
vectors?" from an argument into a number.

One thing worth borrowing from Contextual Retrieval even with no vectors at all: when
indexing a chunk for full-text search, prepend a context line generated **from the graph**
(`[ADR-0003 · accepted · governs core:tempoCost · constrains INV-TEMPO-BITES]`). It
improves BM25 for free, is deterministic, and costs no LLM call.

---

## Prior art this is assembled from

- [Contextual Retrieval — Anthropic Engineering](https://www.anthropic.com/engineering/contextual-retrieval)
- [Agent Skills — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Is Grep All You Need? — arXiv 2605.15184](https://arxiv.org/abs/2605.15184)
- [Codebase-Memory: Tree-Sitter Knowledge Graphs over MCP — arXiv 2603.27277](https://arxiv.org/html/2603.27277v1)
- [Building Claude Code with Boris Cherny — The Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
- [Backlog.md](https://github.com/MrLesk/Backlog.md) — git-native work items
- Packwerk, dependency-cruiser, ArchUnit — the "boundaries are checked, not described" lineage

## Reference implementation

`tools/kb/` in the Dicebound repository. TypeScript, one dependency (`js-yaml`), ~1,400 lines
across twelve files, 129 tests, 97% coverage. All three I/O boundaries — git, the structural
index, and the clock the hazard timer reads — are injected as arguments, which is what makes
it testable and portable.

Not packaged for npm or PyPI yet, on purpose: it should survive one full phase of real use
before anyone else depends on it.
