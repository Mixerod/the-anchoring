# The Anchoring

**An intent graph in git, anchored to code, machine-checked.**

Documentation floats free of code, is written once, drifts within weeks, and nothing notices. Anchoring ties every claim a document makes to a specific, machine-checkable anchor in the code, so that when the code moves, the claim fails loudly instead of quietly becoming fiction.

Read [`docs/THE_ANCHORING.md`](docs/THE_ANCHORING.md) for the architectural pattern and rationale.

---

## 60-Second Quickstart

### 1. Install & Initialize

```bash
npm install -D the-anchoring
# or: pnpm add -D the-anchoring
```

Bootstrap the intent graph in your repository root:

```bash
npx kb init
```

This creates:
- `anchoring.config.json`
- `.anchor/` with directories for `invariant/`, `flow/`, `work/`, `incident/`, `hazard/`, and `session/`
- Standard starter templates (`0000-template.md`)

### 2. Verify

```bash
npx kb verify
```

### 3. Protect Your Intent Graph (The Three Gates)

1. **Stop Hook (AI Agent Session Guard)**: Add to `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "npx kb done --check",
               "timeout": 20
             }
           ]
         }
       ]
     }
   }
   ```

2. **Pre-commit Hook**: In your git hooks (e.g. Husky or `.githooks/pre-commit`):
   ```bash
   npx kb verify
   ```

3. **CI Gate**: In your CI workflow:
   ```bash
   npx kb verify --strict
   ```

---

## The Six Entity Kinds

| Kind | Prefix | Purpose | Links To |
|---|---|---|---|
| **ADR** | `ADR-` | Architectural decisions and context | Code (`governs`), Invariants (`constrains`), Tests (`verified_by`), ADR (`supersedes`) |
| **Invariant** | `INV-` | Non-negotiable rules that must hold | Checks (`enforced_by`), Code (`holds_for`) |
| **Flow** | `FLOW-` | User/system journeys across features | Code (`served_by`), ADR (`decided_by`) |
| **Work** | `W-` | Active and past tasks | ADR (`implements`), Code (`touches`), Incidents (`closes`), Work (`blocked_by`) |
| **Incident** | `INC-` | Post-mortems and bug root causes | Invariant (`violates`), Code (`found_in`, `touches`), Work (`closed_by`, `promoted_to`) |
| **Hazard** | `HAZ-` | External failure modes that could recur | Code/Symbols (`holds_for`), ADR/INV (`resolves_to`) |

---

## Commands

```bash
npx kb ask "<question>"        # front door: what in this repo bears on a topic, plus the techniques
npx kb ctx <W-id>              # progressive disclosure: all context that bears on a task
npx kb why <path|symbol|id>    # reverse walk: what this code or entity is for
npx kb done <W-id>             # closing check: diff vs claims
npx kb verify [--strict]       # machine check every claim across the repository
npx kb skills                  # what agent skills cost, and which ones the graph justifies
```

### Doctrine, and finding it by the situation (`when:`)

An invariant says *this must hold here*, and an anchor proves the code it names exists.
A **doctrine** file in `.anchor/doctrine/` says something different: *this technique answers
that kind of problem*. That is true independently of any repository, so it anchors to
nothing — and the two are treated differently everywhere. Invariants are returned in full and
never ranked; doctrine is ranked and never verified.

The field that makes doctrine findable is `when:` — the signal in a situation that says reach
for this:

```yaml
---
title: Idempotency and delivery semantics
tags: [messaging, retries, payments]
when:
  - a retry could apply the same effect twice
  - a consumer may receive the same message more than once
---
```

A technique's *name* is a poor retrieval key: the agent that already knows the name did not
need to look it up, and the agent that needs it is holding a symptom and no name at all. So
`when:` outweighs tags, title, and filename combined, and both `kb ask` and `kb ctx` print the
trigger line that fired, so a reader can judge the match without opening the file:

```
$ kb ask "a file has grown until changes feel unsafe"

Doctrine
  module-boundaries.md - Module Boundaries
    when: a file has grown until changes feel unsafe
    .anchor/doctrine/module-boundaries.md
  5 more (no trigger matched): gates-and-automation.md, judgment-under-uncertainty.md, ...
```

`kb ctx <W-id>` runs the same ranking against the work item's title and tags and names the
techniques under **Technique that may apply** — and says so out loud when nothing matched,
because a section that vanishes reads as "no technique applies", which is a claim the corpus
cannot support.

Frontmatter is **optional**. Every doctrine file written before triggers existed still loads,
still lists, and simply never outranks one that declared a trigger.

**A trigger is a hint, not a claim.** Nothing checks that a `when:` line is true, in exactly
the sense `.anchor/doctrine/tags-are-hints.md` sets out for tags. It is scored, never
verified, and must never be cited as evidence.

### Agent skills (`kb skills`)

If your repository delivers agent skills through the
[@skills protocol](https://github.com/SylphAI-Inc/atskills) — a `.atskills/` directory and a
`.atskills/.autotrigger` file — `kb skills` weighs what that costs and checks it against the
intent graph.

Only `.autotrigger` lines cost resident prompt tokens, and the protocol's own recommendation
is to keep them under ten. This command prints that budget with a token estimate, and warns
about every resident skill that **no document anchors**:

```
Tier 3 - .atskills/.autotrigger (2 skills, ~34 tok/message, estimated at 4 bytes/token)
  [ok]   team-flows/deploy  ~21 tok  <- W-16
  [warn] team-flows/review  ~13 tok  <- nothing in the graph anchors it
```

A skill earns its residency the same way anything else in this repository does: a document
says why. Anchor it from a work item, invariant, or decision with an ordinary `file:` anchor —
no new anchor form is involved, because a skill folder is an ordinary path:

```yaml
touches:
  - file:.atskills/team-flows/deploy
```

**`kb skills` never writes.** `.atskills/` belongs to your project and to the protocol, not to
this tool, so a suggested line is printed for you to paste. The check is advisory and always
exits 0: a gate that blocks on bookkeeping is one you switch off within a week.

## License

[MIT](LICENSE)

---

## Engineering Knowledge Packs

Cross-repository invariants, hazards, and doctrine are distributed as **packs**:

```bash
npx kb pack list                     # view available packs
npx kb pack add discipline           # seed the discipline pack into .anchor/
npx kb pack check                    # verify that seeded knowledge has not drifted
```

### The packs

| Pack | Covers |
|---|---|
| `discipline` | module boundaries, credential safety, agent verification discipline |
| `systems-core` | request path, traffic management, caching, database performance, distributed data |
| `systems-async` | queues, delivery semantics, idempotency, sagas, event sourcing, CQRS |
| `systems-reliability` | timeouts, retries, circuit breakers, backpressure, scaling, disaster recovery |
| `systems-platform` | containers and Kubernetes, delivery pipelines, security and identity |
| `systems-production` | observability and SLOs, concurrency and runtime, incident response |

`discipline` is about how to work. The five `systems-*` packs are engineering technique, and
every file in them is written as a **decision** rather than a definition: the signal that calls
for a technique, the cheaper thing to try first, what it costs, and how it fails. A definition
is what an agent already has; the signal is what it lacks.

Adopt them one at a time. A CLI library has no business seeding fifteen files about Kubernetes,
and `kb pack check` only checks the packs a repository has actually adopted — it names the rest
and leaves them alone.

**They ship doctrine and nothing else — no invariants, no hazards.** An invariant needs a
checker that exists in *your* repository, and a hazard is something that happened *here*, with
a date. A pack cannot know either, and an unsupported claim is worse than a missing one.

### What that buys, concretely

```
$ kb ask "the webhook must not double charge when we retry it"

Doctrine
  delivery-semantics.md - Idempotency, delivery semantics, and why exactly-once is a lie you can arrange
    when: a payment, charge, or transfer must not be duplicated
    .anchor/doctrine/delivery-semantics.md
  ...
  5 more (no trigger matched): caching.md, concurrency-runtime.md, ...
```

All twenty files are `residency: index`, so the corpus does not become a tax on every cold
start. Measured on a repository with all five packs seeded: **160,618 bytes on disk, 14,912
bytes in tier 1 of `kb brief`** — the body is read only when a trigger fires. `kb verify` warns,
advisory and never gating, if tier-1 doctrine passes its budget.
