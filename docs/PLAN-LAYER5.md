# Layer 5 — the context economy

Written 2026-08-28, after Layer 4 landed. Three parts, handed to three agents.

---

## 1. What this layer is, and why it exists

Layers 1–4 answered *what does an agent need to know.* Layer 5 answers *what does it cost to
tell it, every single time.*

Nothing in the tool today knows its own price. It emits text sized for a human reading a
terminal, in an order nobody guaranteed, with colour codes nobody asked for, and repeats the
whole stable corpus on every call. For a human that is free. For an agent it is a bill paid
hundreds of times a day, and — this is the part that matters — **it is a bill that fails
silently.**

### The mechanism this layer is built around

Prompt caching is a **prefix match**. The rules, which shape everything below:

- One byte changed anywhere in the prefix invalidates **everything after it**.
- Render order is `tools` → `system` → `messages`.
- **At most four cache breakpoints** per request.
- The minimum cacheable prefix is 512–4096 tokens depending on model. Below it, content
  **silently does not cache** — no error, no warning.
- Cache write costs ~1.25× normal input; cache read costs ~0.1×.

Measured on this repository today: `.anchor/` is 37,588 bytes ≈ 9.4K tokens, of which the
stable part (doctrine, invariants, ADRs) is roughly 6K — comfortably above the minimum, so it
is genuinely cacheable. Over a 50-call session:

```
no caching:   50 × 6K                    = 300K tokens billed
with caching: 6K × 1.25 + 49 × 6K × 0.1  ≈  37K tokens billed   (~8×)
```

**A cache miss announces nothing.** You pay ten times as much and every output looks
identical. That is precisely the shape of `INC-0001` — a mechanism that fails while appearing
to succeed — reappearing in the cost layer instead of the correctness layer. This layer is
that incident's lesson applied where it has not yet been applied.

### The consequence that reframes earlier work

`docs/PLAN-LAYER4.md` §B.2 required deterministic output from `kb ask`, justified as making
the command diffable and testable. That justification was too small. **Byte-identical output
is the cache-hit condition.** Unstable directory-read order, a timestamp in a header, a `Map`
iterated in insertion order — each is a 10× cost multiplier, applied silently. Determinism is
not hygiene here; it is the mechanism.

### Loops and caches are one problem

An agent loop that rewrites its context each iteration destroys the cache. One that appends
only the new findings keeps the prefix intact. So the single principle underneath Part A is:

> **Append-only. Stable prefix, delta suffix.**

This is why Part A is one part and not three. Split across three agents, three designs would
emerge and collide.

### The three parts

| Part | Feature | Depends on |
|---|---|---|
| A | `kb brief`, `kb verify --since`, no-progress detection | nothing |
| B | Colour discipline, corpus token accounting, body budget | nothing |
| C | Negative space in `kb ask`, a checker for `tags:` | nothing |

All three are independent and may run in parallel.

---

## 2. Rules inherited from every previous layer

Restated because these are the ones that get broken.

1. **Split plan from apply.** Pure `planX(input)`, thin `applyX(plan, io)`. Follow
   `planInit`, `planGuards`, `planUpstream`, `planPack`.
2. **Purity is the redaction mechanism.** Domain modules perform no I/O: no `node:fs`, no
   `node:child_process`, no `node:crypto`, no `new Date()`. Injected as arguments.
3. **Never edit a file the host owns.** Write under `.anchor/` or `anchoring.*` and *print*
   what the user must add.
4. **A generated file carries a header naming its source and a hash.** FNV-1a via the
   existing `hashableBody` canonicalisation; do not invent a second one.
5. **Fix the code, not the threshold.** `maxFileLines` 400, `maxFunctionLines` 50.
6. **No seventh entity kind.**
7. **No network, from any command, for any reason.** In particular: this tool never calls a
   model and never counts tokens by asking an API. See §4.2.
8. **An advisory gate reports; it never fails the turn.** A gate that blocks on bookkeeping
   is switched off within a week, and then nothing is enforced. This governs every threshold
   introduced in Part B.
9. **Silence must be earned.** Write the test where the check must *speak*.
10. **Report the command's actual output.**

### Baseline to confirm before starting

```
npm install && npm run verify
npm run kb -- verify --strict          # expect: kb verify: clean
#
# The count in this line was 31/264 when the plan was written and has moved since with
# ordinary commits. Check that it is *clean*, and investigate a change in the numbers
# rather than treating either the old or the new figure as the criterion.
```

If either differs, stop and report. Do not start fixing.

---

## 3. Part A — `kb brief`, delta verification, and knowing when a loop is stuck

### A.1 `kb brief` — the cacheable cold-start bundle

```
kb brief [--json] [--check]
```

Emits the whole stable context an agent needs at cold start, arranged in **four volatility
tiers**, because four is exactly how many cache breakpoints a request may carry.

| Tier | Content | Changes | Cacheable |
|---|---|---|---|
| 1 | `AGENTS.md`, then `.anchor/doctrine/*` | monthly | yes |
| 2 | `INV` (active), then `ADR` (accepted) | weekly | yes |
| 3 | `FLOW` (live), then `HAZ` (active) | daily | yes |
| 4 | `WORK` (open), session state, counts, any summary line | per call | **no** |

The ordering of the tiers is the point: most-stable first, so a change in tier 3 does not
invalidate tiers 1 and 2.

**Within a tier, ordering must be total and deterministic:** sort by kind in the order above,
then by id ascending, using a plain codepoint comparison. **Never** filesystem order — a
`readdir` result is not a guaranteed order, and on a different machine it will differ, which
means a silent cache miss on every call.

**The trap that will catch you.** Any summary that moves — an entity or anchor count, a
timestamp, a git SHA, a duration — placed anywhere in tiers 1–3 invalidates every tier after
it on the next commit. All of it belongs in tier 4. Write the test that asserts tiers 1–3
contain no digit sequence derived from a count.

**Text output** delimits tiers with comment markers, so a harness can split on them:

```
<!-- kb:brief:tier:1 -->
...
<!-- kb:brief:tier:2 -->
```

**`--json`** emits `{ tiers: [{ level, content }], generated_from }` so a harness can map each
tier to one `cache_control` breakpoint directly. This is the form a harness actually consumes;
treat it as the primary interface and the text form as the human view.

### A.2 `--check` — the only cache guarantee this tool can make

This tool never calls a model, so it cannot observe a cache hit. What it *can* guarantee is
byte-stability, which is the precondition. Be precise about that boundary in the docs: **the
tool guarantees the prefix does not move; the harness verifies the hit** by reading
`usage.cache_read_input_tokens` and treating a persistent zero as a defect.

`kb brief --check` renders twice from two independent loads of the corpus and compares bytes,
reporting the first differing offset and the tier it falls in. Exit non-zero on difference.

This is the negative-path test made into a command. Write a unit test that feeds a corpus
whose load order is deliberately shuffled and asserts the output is identical.

### A.3 `kb verify --since <git-ref>`

Restricts findings to entities whose file changed since the ref, plus any entity whose
anchors point at a file that changed. Uses the existing `git.ts` infra module; the domain
half receives the changed-path list as an argument and stays pure.

Two reasons, and the second is the important one:

1. A loop iteration should not re-derive what it already knows.
2. **It keeps the prefix stable.** Full output re-rendered each iteration rewrites the
   context; a delta appends. That is the difference between a loop that caches and one that
   does not.

`--since` with no changed paths prints an explicit "no entities changed since `<ref>`" line,
not empty output. Empty output is indistinguishable from a broken command — see `INC-0001`.

### A.4 No-progress detection

A loop that cannot say *"I am stuck"* burns money indefinitely, and does so while looking
busy. Their own doctrine: a mechanism that can never say no reports noise until it is
switched off.

- `kb verify` gains `--fingerprint`, printing a stable hash of the **finding set** (ids,
  fields and messages; not counts, not order-dependent, not timing).
- `kb done --check` — already the Stop-hook gate — stores the fingerprint in
  `${kbRoot}/session/` (already gitignored, already the established place for ephemeral
  state) and reports when the fingerprint has been unchanged across **three** consecutive
  runs: *"no progress across 3 runs; the same N findings persist."*

**This warns. It never fails the turn**, not even under `--strict`. It is advisory by
construction: a loop-detector that blocks a commit is a loop-detector that gets uninstalled,
and rule 8 exists because that has already happened to other people's tools.

Write the test where it must speak: three runs with an identical finding set produce the
warning; a run where one finding is fixed resets the counter.

### A.5 Part A acceptance

- `npm run verify` green; new modules obey the layer matrix (`npm run lint:depcruise`).
- `kb brief` output splits into four tiers in the documented order.
- `kb brief --json` gives one object per tier, consumable without parsing prose.
- `kb brief --check` exits 0 on this repository, and exits non-zero with an offset and a tier
  number when fed deliberately unstable input.
- Tiers 1–3 contain no count, timestamp, SHA or duration — with a test.
- Two consecutive `kb brief` runs are byte-identical, and remain so when the corpus is loaded
  in shuffled order.
- `kb verify --since HEAD~1` reports only affected entities; with no changes it says so in
  words.
- Three identical `kb done --check` runs produce the no-progress warning and **exit 0**.
- State the byte size of `kb brief` output and the size of each tier, as numbers.

---

## 4. Part B — colour discipline, token accounting, and a body budget

### B.1 Colour: a confirmed defect, with the fix already half-built

`src/render.ts` defines a full `Palette` and a `PLAIN` palette of empty strings. **`PLAIN` is
referenced only from tests.** Production always emits ANSI, including when stdout is a pipe:

```
$ npm run kb -- verify --strict | tail -2
\x1b[32mkb verify: clean\x1b[0m \x1b[2m(31 entities, 264 anchors)\x1b[0m
```

For a human this is invisible. For an agent capturing the output it is tokens paid for escape
sequences plus parsing noise, on every call, forever.

Select `PLAIN` when **any** of: `process.stdout.isTTY` is falsy; `NO_COLOR` is set to any
value (the published convention); or `--no-color` is passed. Add `--color` to force colour
back on for a human piping into a pager.

This is a rendering decision, so it belongs at the CLI boundary — `render.ts` keeps taking a
palette as an argument and learns nothing about `process`.

Write the test that asserts piped output contains no `\x1b`. That is the test where the check
must speak.

### B.2 Corpus token accounting — and the honesty requirement

`kb brief --stats` (and a line at the end of `kb verify --strict`) reports the size of the
corpus, broken down by tier and by kind.

**Report bytes as the measured number.** A token estimate may accompany it, but it must be
labelled an estimate and must state its divisor, because this tool does not call a tokenizer
and must not pretend to a precision it does not have. Rule 7 forbids the network; inventing a
confident token count without one would be exactly the over-claiming the discipline rules
exist to prevent.

Suggested form:

```
corpus: 37,588 bytes  (tier1 14,904 · tier2 12,110 · tier3 4,206 · tier4 6,368)
        ≈ 9,400 tokens (estimate, bytes÷4; verify with your model's tokenizer)
```

### B.3 A body budget, and why it must never fail the build

Entity **bodies** are 70% of the corpus (26,232 of 37,588 bytes measured today) and nothing
bounds them. `src/` has `maxFileLines: 400`; a doctrine file may grow to any size, and every
agent pays for it on every cold start, forever.

Add `maxBodyBytes` to `anchoring.config.json`, defaulting to **6000**, and report a
**warning** for any entity body above it, naming the entity and the excess.

**This must be a warning under every flag, including `--strict`.** Not an error, ever. A
build that fails because a document is verbose is a build people learn to bypass, and then
the checks that matter go with it. Rule 8. Say this in the code comment, not only here, so
the next person does not "tighten" it.

### B.4 Part B acceptance

- `npm run verify` green.
- `kb verify | cat` produces output containing no `\x1b`, with a test.
- `NO_COLOR=1 kb verify` on a TTY produces no escape codes.
- `kb brief --stats` reports bytes per tier and per kind, with the token figure explicitly
  labelled an estimate and its divisor stated.
- An entity with a body over `maxBodyBytes` produces a warning; `kb verify --strict` with
  that warning present still **exits 0** — with a test asserting the exit code.
- State the current corpus byte breakdown in your report.

---

## 5. Part C — retrieval honesty

### C.1 Negative space in `kb ask`

`kb ask` today returns every active invariant, every open hazard, and ranked matches. What it
never says is **what it left out.**

Measured now: this repository has 9 invariants, and `kb ask` returns all 9 on every query.
That is correct — an invariant that applies only when a keyword matches is not an invariant —
but the report is silent about the hazards it filtered, the entities that scored zero, and
the kinds it did not search. A filter whose rejections are invisible cannot be audited, and
an unauditable filter is trusted right up until it is ignored.

Add a closing section naming, in one line each:

- how many entities were searched, and how many scored zero;
- hazards **not** shown and why (`resolution: guarded` — already handled);
- retired invariants and superseded ADRs excluded, with counts. Note that superseded ADRs
  were *not* excluded from ranking before this layer, so excluding them is a change to what
  `kb ask` returns, not merely a count of something already happening;
- for a query matching nothing, the existing negative report stays, plus these counts.

Keep it to counts and reasons. Do not list the excluded entities — that would reintroduce the
cost this whole layer is about.

### C.2 A checker for `tags:`

`tags:` was added in Layer 4 as hand-maintained metadata with no checker. It is the one place
this project reintroduced the drift it exists to abolish: an anchor is verified, a tag is
not, and a misspelled tag fails silently by simply never matching.

Give it a closed list and a default, per the discipline rule:

- **Optional vocabulary.** If `anchoring.config.json` declares `tags: { vocabulary: [...] }`,
  a tag outside it is an **error**. A declared vocabulary is a deliberate choice, and
  enforcing it is what makes it worth declaring.
- **Default when undeclared.** Report as a **warning** any tag used exactly once across the
  whole corpus. A one-off tag is either a typo or a private note; neither is a shared
  vocabulary, and both make retrieval quietly worse. Warning, not error — see rule 8.
- Validate shape (lowercase slug) as an error in both modes; that is a format rule, not a
  judgment.

Document in the pack's doctrine that tags are a **retrieval hint, not a claim**: unlike an
anchor, a tag asserts nothing checkable about the code, and no reader should treat it as
evidence.

### C.3 Part C acceptance

- `npm run verify` green.
- `kb ask "architecture layering"` ends with the exclusion counts.
- `kb ask "quantum teleportation scheduler"` still produces the negative report, now with
  counts.
- A singleton tag produces a warning; `--strict` still exits 0 on it.
- With `tags.vocabulary` declared, an out-of-vocabulary tag is an error and `--strict`
  exits 1.
- A non-slug tag is an error in both modes.
- Output remains byte-identical across two consecutive runs.

---

## 6. Out of scope for Layer 5

- Calling any model, any tokenizer service, or any network endpoint.
- A persistent index, cache, or embedding store. `kb brief` renders from the corpus every
  time; that is the whole design.
- Implementing prompt caching itself. This tool emits a cache-*shaped* artifact; wiring
  `cache_control` breakpoints belongs to whatever harness consumes it.
- A seventh entity kind.
- Any threshold in Part B becoming a hard failure.

---

## 7. Reporting

Each part ends with a written report containing:

1. The actual output of `npm run verify` (last lines) and `kb verify --strict`.
2. Entity and anchor counts, and for Parts A and B the byte measurements requested.
3. Every acceptance item, marked with what it actually printed.
4. Every defect found in this plan. It was written without executing it; each previous plan
   in this repository contained three to five. A correction is a contribution.

---

## Addendum — defects found while executing this plan

This plan was written without running it. The following were found during implementation and
are recorded here so the next reader is not misled by the text above.

1. **The baseline count is stale.** §2 and §3 quote `31 entities, 264 anchors`. Three
   entities were committed after the plan was written, so a correct run reports more. The
   criterion is `clean`; a changed count is something to explain, not to fail on.

2. **§A.1's tier test cannot be written as specified.** "Tiers 1–3 contain no digit sequence
   derived from a count" is unsatisfiable against real bodies — doctrine prose legitimately
   contains sentences like "48 packages, 30 enforced boundaries". The property that is both
   checkable and meaningful is that tiers 1–3 are byte-identical when the volatile facts
   change, plus that the renderer injects nothing into a stable tier but markers naming a
   path. Both are implemented.

3. **§B.1 overstates the colour defect.** `PLAIN` was not "referenced only from tests":
   `cli.ts` selected it for `--no-colour`. The real defect was narrower and worse — nothing
   consulted `isTTY` or `NO_COLOR`, so every piped run carried escapes.

4. **§B.3 does not say what a clean run should do.** Left unstated, three consecutive
   finding-free runs would have warned "no progress; the same 0 findings persist". A green
   repository is not a stuck loop, and the implementation never warns on an empty finding
   set.

5. **§B.2's "corpus" is ambiguous and, read narrowly, dishonest.** The brief excludes
   incidents, retired documents and closed work. Reporting only the bundled part under the
   word "corpus" understated this repository by more than 20,000 bytes. Both figures are now
   reported, with the excluded documents counted and named.

6. **§C.1 assumes superseded ADRs were already excluded from `kb ask`.** They were not, so a
   count of "superseded decisions excluded" would have described something that never
   happened. They are excluded now — a deliberate behaviour change, noted above.

7. **The whole plan assumed the architecture guards worked.** They did not: every generated
   pattern matched nothing, so "obeys the layer matrix" was a vacuous acceptance item in all
   three parts. See `.anchor/incident/INC-0004.md`.
