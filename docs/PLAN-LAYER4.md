# Layer 4 — the portable half

Written 2026-08-28. Specifies three features, handed to three agents as Parts A, B and C.

---

## 1. What this layer is, and why it exists

Everything built so far makes **one repository** legible: why its code exists, what must
hold in it, how it has broken. Every anchor is `file:src/foo.ts` — true here, meaningless
anywhere else. That is correct and deliberate, and it is only half of what this tool is for.

The other half is **experience that travels**. A lesson learned in project A is worth
nothing if it dies with project A's `.anchor/` directory. The owner's stated goal is: install
this into any new repository, ask it a question, and the accumulated engineering judgment of
every previous project is already present.

Two mechanisms for that were designed and never built:

- `kb init --guards` seeds five architecture invariants. It proves seeding works. It is
  hardcoded, ships exactly five documents, and cannot grow.
- The `HAZ` kind is defined as *"a failure mode that has happened **elsewhere**, whose
  mechanism this repo could reproduce."* There is no way for one to arrive from elsewhere.
  Every hazard must be typed by hand, in every repository, forever.

Layer 4 closes both. **Part A** makes seedable knowledge a first-class, growable artifact (a
*pack*). **Part B** gives the tool an entry point that answers "what applies to what I am
about to do" before a work item exists. **Part C** builds the return path: a local incident
becomes a pack hazard, and the next repository inherits it.

### The three parts, and what depends on what

| Part | Feature | Depends on |
|---|---|---|
| A | Packs — `kb pack list / add / check`, `kb init --pack` | nothing |
| B | `kb ask "<free text>"` | nothing (may ship before or after A) |
| C | `kb promote <INC-id> --to-pack <name>` | **Part A must be merged first** |

A and B are independent and may run in parallel. C must not start until A is on `main`.

---

## 2. Rules inherited from every previous layer

These are not new and they are not negotiable. They are restated because they are the ones
that get broken.

1. **Split plan from apply.** A pure `planX(input) -> description of writes` plus a thin
   `applyX(plan, io)`. `--dry-run` is a rendering of the plan, never a second code path.
   Follow `planInit`/`applyInit`, `planGuards`, `planUpstream` exactly.
2. **Purity is the redaction mechanism.** Domain modules perform no I/O: no `node:fs`, no
   `node:child_process`, no `node:crypto`, no `new Date()`. Clocks and filesystems arrive as
   arguments. This is enforced by ESLint via `anchoring.guards.mjs`, so violating it fails
   the build — but understand *why* before working around it: a function that cannot read a
   file cannot leak one.
3. **Never edit a file the host owns.** Write only under a namespace that is unmistakably
   ours (`.anchor/`, `anchoring.*`), and *print* the lines the user must add themselves.
   This applies with full force to `~/.claude/` in Part A: **you do not write there.**
4. **A generated file carries a header naming its source and a hash of it.** Then "the
   source changed" is distinguishable from "someone edited the output" — different mistakes,
   different fixes. Hash with FNV-1a over a canonical body, as `guardsHash` and
   `upstreamHash` already do. Do not import `node:crypto`; the domain layer is pure.
5. **Fix the code, not the threshold.** `maxFileLines` is 400 and `maxFunctionLines` is 50.
   If a module outgrows the ceiling, split the module. Loosening a check to make it pass is
   an automatic review failure.
6. **No seventh entity kind.** Packs, doctrine files and promotion are fields, directories
   and projections — exactly as `owners` and `upstream` are. `loadStore` must not load a
   doctrine file and `kb verify` must not check one.
7. **No network, from any command, for any reason.** A pack is a directory on disk. It is
   not fetched, not resolved from a registry, not versioned over HTTP.
8. **Report the command's actual output.** Paste what it printed. "Tests green" is not
   evidence.
9. **A check needs the test where it must *speak*,** not only the one where it must pass.
   Silence must be earned.

### Baseline to confirm before starting

```
npm install && npm run verify          # 364 tests, typecheck, eslint, depcruise all pass
npm run kb -- verify --strict          # kb verify: clean (26 entities, 196 anchors)
```

If either differs, stop and report. Do not start fixing.

---

## 3. Part A — Packs

### A.0 The idea in one paragraph

A **pack** is a directory of portable engineering knowledge: invariants that any repository
should hold, hazards learned elsewhere, and doctrine prose that cannot be machine-checked.
`kb pack add <name>` copies it into this repository's `.anchor/`, stamping every file with
its source and a hash, so `kb pack check` can later tell drift from hand-editing. A pack is
the unit in which experience travels between projects.

### A.1 Pack format

```
<pack-root>/
  pack.json
  invariant/*.md      INV- documents (frontmatter + body), holds_for left empty
  hazard/*.md         HAZ- documents
  doctrine/*.md       prose; not an entity, never loaded by loadStore
```

`pack.json`:

```json
{
  "name": "discipline",
  "version": "1.0.0",
  "description": "Module boundaries, secret handling, and agent verification discipline."
}
```

All three fields are required. `name` must match `^[a-z][a-z0-9-]*$`. `version` must be
three dot-separated non-negative integers. Any other key is an error naming the accepted
keys — parse it in the shape of `parseConfig`, returning
`{ ok: true, pack } | { ok: false, problems }`. Never throw for bad input.

### A.2 Resolution — where packs are found

In order:

1. **Built-in:** `templates/packs/<name>/`, shipped inside the npm package. `package.json`
   already lists `templates` under `files`, so this needs no packaging change.
2. **User packs:** each directory listed in the `ANCHORING_PACKS` environment variable,
   split on the platform path delimiter (`;` on Windows, `:` elsewhere — use
   `node:path`'s `delimiter`).
3. **Default user pack directory:** `~/.anchoring/packs/`.

**A name found in two sources is an error, not a shadowing.** Report both absolute paths and
exit non-zero. Silent precedence is how a user ends up seeding a pack they did not mean to,
and finds out months later.

Resolution touches the filesystem, so it lives in **infra** (`src/pack-source.ts`), not in
the pure planner. The planner receives an already-loaded `Pack` value.

### A.3 Modules and signatures

| File | Layer | Contents |
|---|---|---|
| `src/pack.ts` | domain (pure) | `parsePackManifest`, `planPack`, `packHash`, `checkPack`, types |
| `src/pack-source.ts` | infra | `resolvePacks`, `loadPack`, `userPackDirs` |
| `src/cli-pack.ts` | cli | argument parsing and rendering for `kb pack *` |

Add `src/pack.ts` to the `domain` layer and `src/pack-source.ts` to `infra` in
`anchoring.config.json`, and regenerate the guards (`kb guards`) so the ESLint and
dependency-cruiser fragments include them. Do not hand-edit `anchoring.guards.mjs` or
`anchoring.depcruise.cjs`.

```ts
export interface PackManifest {
  readonly name: string
  readonly version: string
  readonly description: string
}

export interface PackFile {
  readonly kind: 'invariant' | 'hazard' | 'doctrine'
  readonly basename: string          // e.g. "INV-SECRETS-NO-LITERALS.md"
  readonly body: string
}

export interface Pack {
  readonly manifest: PackManifest
  readonly files: readonly PackFile[]
  readonly origin: string            // absolute dir, for error messages only
}

export interface PackPlan {
  readonly pack: PackManifest
  readonly files: readonly GeneratedFile[]   // reuse the type from guards.ts
  readonly dirs: readonly string[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
  readonly notes: readonly string[]
}

export function planPack(
  pack: Pack,
  config: AnchoringConfig,
  existing: (relPath: string) => string | undefined,
): PackPlan
```

`existing` is how the planner learns what is already on disk **without doing I/O itself** —
the same trick `planUpstream` uses to allocate stable ids. The caller reads; the planner
decides.

`planPack` performs **no I/O and calls no clock.** If you find yourself wanting `new Date()`
for a `recorded:` field, pass the date in as an argument.

### A.4 Where seeded files land

| Pack directory | Destination | Loaded by `loadStore`? |
|---|---|---|
| `invariant/` | `config.kinds.INV.dir` | yes — a real `INV` entity |
| `hazard/` | `config.kinds.HAZ.dir` | yes — a real `HAZ` entity |
| `doctrine/` | `${config.kbRoot}/doctrine/` | **no** |

`.anchor/doctrine/` is a new directory and **is not an entity kind.** It follows the `UP-`
precedent exactly: a generated artifact that `loadStore` must not load and `kb verify` must
not check. Add a test asserting `loadStore` ignores it — that is the test where the rule
must *speak*.

### A.5 The generated header

Every seeded file gets this header, before the YAML frontmatter for entity files and at the
top for doctrine files:

```
<!-- the-anchoring:pack discipline@1.0.0 hash:3fa9c21b7e04d5a6 -->
<!-- Seeded by `kb pack add discipline`. Edit freely — `kb pack check` will report it as
     hand-edited rather than overwrite it. -->
```

`packHash(body)` is FNV-1a over the canonical body, computed exactly as `upstreamHash` is.
Read `hashableBody` in `src/upstream.ts` and match its normalisation; do not invent a second
canonicalisation rule.

### A.6 `checkPack` — the drift check

Reuse the state union already exported from `guards.ts`:

```ts
export type PackFileState = 'ok' | 'missing' | 'stale' | 'hand-edited'
```

- `ok` — the file exists and its hash matches the header, which matches the pack.
- `missing` — the pack declares it and the repository does not have it.
- `stale` — the header's hash matches the file, but the pack's current content hashes
  differently. **The pack moved on.** Re-adding is safe.
- `hand-edited` — the file's content does not hash to what its own header claims. **The user
  changed it.** Re-adding would destroy their work; `kb pack add` must refuse without
  `--force`, and say which files and why.

The distinction between `stale` and `hand-edited` is the entire reason the header exists.
Get it right and test both.

### A.7 CLI surface

```
kb pack list                     # every resolvable pack, its source, version, file counts
kb pack add <name> [--dry-run] [--force]
kb pack check [<name>]           # drift report; exit 1 on hand-edited under --strict
kb init --pack <name>            # init, then seed the named pack
```

`kb pack add` prints, per file, one of `wrote`, `skipped (hand-edited)`, `unchanged`. A
command that writes twelve files and says nothing is indistinguishable from one that wrote
nothing — see `INC-0001`.

### A.8 The `discipline` pack — the first pack's content

The content already exists on this machine, at `~/.claude/rules/personal/`:
`10-module-boundaries.md`, `20-secrets.md`, `30-agent-discipline.md`.

**You must not write to `~/.claude/`, edit those files, or delete them.** Read them, and
build `templates/packs/discipline/` from what they say. At the end, *print* for the owner
the suggested replacement text for those three files (a pointer at the pack), and let them
apply it themselves. This is rule 3 and it is not optional.

Split the material by what a machine can actually check:

**`invariant/` — machine-checkable, each with a real checker.**

- `INV-SECRETS-NO-LITERALS.md` — no structured credential literal in any tracked file.
  Enforceable: the Tier 1 regex set in `20-secrets.md` is precisely a checker. Ship it as a
  generated script alongside the guards, in the shape of `scripts/anchoring-*.mjs` that
  `planGuards` already emits. Tier 2 (bare words like `secret`, `password`) **must not** be
  in the checker: it was measured at a 100% false-positive rate, and a scanner that cries
  wolf gets switched off. Say that in the document body.
- Do **not** duplicate `INV-NO-CYCLES`, `INV-DEP-DIRECTION`, `INV-MODULE-ENTRY`,
  `INV-PURE-CORE`, `INV-FILE-SIZE`. Those ship via `kb init --guards` and are listed in
  `SHIPPED_INVARIANTS`. Two sources for one invariant is the drift this project exists to
  prevent. The pack's doctrine may *reference* them by id.

**`doctrine/` — true, load-bearing, and not machine-checkable.** Prose an agent reads.

- `verification-and-honesty.md` — report actual output; a number in an acceptance criterion
  is a criterion; a reference is a path or symbol, never a line number.
- `judgment-under-uncertainty.md` — default to local fault; every classification gets a
  closed list and a default; a mechanism that can never say "no" reports noise until it is
  switched off.
- `gates-and-automation.md` — an advisory gate reports and never fails the turn; silence
  must be earned; anything on every turn is milliseconds and never calls a model.
- `module-boundaries.md` — the dependency matrix is written down; a module owns its data;
  UI and handlers only move data; split on "two reasons to change", not line count.
- `solid.md` — **be honest here.** Dependency inversion and interface segregation are
  substantially covered by `INV-DEP-DIRECTION` and `INV-MODULE-ENTRY`. Single
  responsibility, open/closed and Liskov are **not** machine-checkable in general. Say so
  explicitly and state them as prose an agent should weigh, not as invariants. Do not create
  an `INV-` for a rule that has no checker: *an invariant without a checker is a wish*, and
  the tool's own invariant template says exactly that.

**`hazard/` — leave empty in this part.** Populating it is Part C's job, from real
incidents. A pack that ships invented hazards is the "war story nobody verified" failure the
`HAZ` kind was built to replace. See §5.3 for why seeding hazards at all is dangerous.

### A.9 AGENTS.md

`templates/AGENTS.md` gains a section pointing at `.anchor/doctrine/` — rendered only when
doctrine files are actually present, in the shape `renderAgentsMd` already uses for the
architecture block (`ARCHITECTURE_START_MARKER`). An empty section that says nothing is
worse than no section.

### A.10 Retire the manual-review note

`README.md` currently ends with *"No anchor can reach across that boundary, so nothing
checks the two against each other... review that file in the same sitting."* That is a
paragraph standing in for a mechanism — the precise failure this project exists to abolish,
committed in its own README.

Once the content lives in `templates/packs/discipline/`, an anchor **can** reach it. Delete
that section and replace it with a pointer to the pack. Then add the anchors: the pack's
doctrine files become `holds_for:` targets of a new `INV-` in this repository, or are
governed by an ADR. Whichever you choose, `kb why templates/packs/discipline/` must return
something.

### A.11 Part A acceptance

- `npm run verify` green; the new modules obey the layer matrix (`npm run lint:depcruise`).
- `kb pack list` shows `discipline` with its source path and file counts.
- `kb pack add discipline --dry-run` prints every file it would write and writes nothing.
- `kb pack add discipline` in a scratch repository produces a corpus that
  `kb verify --strict` reports clean.
- `kb pack check` reports `ok` immediately after; edit one seeded file by hand and it
  reports `hand-edited`; bump the pack's version and content and it reports `stale`.
- `loadStore` ignores `.anchor/doctrine/` — with a test.
- `~/.claude/` is untouched. `git status` in this repository shows only intended files.
- This repository's own `kb verify --strict` still clean, and the entity count has grown by
  exactly the number of entities you added. State the new number in your report.

---

## 4. Part B — `kb ask`

### B.0 The gap

`AGENTS.md` §1 tells an agent: *run `kb ctx W-<n>`; if you were not given one, ask for it or
open one.* Every retrieval path in the tool starts from an entity that already exists. There
is no way to ask *"I am about to add a payment webhook — what in this repository bears on
that?"* before any work item exists. That question is the moment the owner described as the
whole point: install it, ask, and the agent knows what to do.

### B.1 Surface

```
kb ask "<free text>" [--json] [--limit <n>]
```

Returns, as a `render.ts`-style report:

1. **Always, in full: every `active` INV.** They are non-negotiable and few. An invariant
   that applies only when a keyword matches is not an invariant.
2. **Always: every `active` HAZ whose `resolution` is `open`.** An unread hazard is worse
   than none — that is why the clock exists.
3. **Ranked by relevance: ADR, FLOW, WORK, INC** — default `--limit 8` per kind.
4. **Doctrine file names** from `.anchor/doctrine/`, if Part A has landed. Names and
   headings only; do not inline the prose.

### B.2 Retrieval — and the constraint that shapes it

**No embeddings, no vector store, no index, no cache.** `docs/THE_ANCHORING.md` argues this
at length and the argument is load-bearing: staleness is the decisive problem, and an index
that silently disagrees with the corpus is worse than none. Re-read the corpus every call.

**The hard constraint:** `store.ts` never loads a document body, and this is stated twice in
its own comments. `kb ask` must not be the reason it starts.

So match on frontmatter only:

- Add `tags` to `SCALAR_FIELDS` for **every** kind in `src/model.ts` — a list of lowercase
  slugs. `model.ts`'s own comment promises adding a field is a one-line change; hold it to
  that.
- Score over: `id`, `title`, and `tags`. Tokenise on non-alphanumerics, lowercase, drop a
  small closed stopword list. Score = weighted term overlap: `tags` ×3, `title` ×2, `id` ×1.
  Length-normalise so a long title does not win by accident.
- Ties break by id, ascending, so output is deterministic. A retrieval command whose output
  reorders between runs cannot be diffed or tested.

Implement scoring as a pure function in `src/ask.ts` (domain layer), taking `Store` and a
query string. No I/O, no clock except an injected one.

### B.3 The negative path

**A query that matches nothing must say so, loudly and specifically** — naming the query, the
corpus size searched, and the fact that the invariants above still apply. A retrieval tool
that returns a plausible-looking list for every input is unauditable, and an unauditable
filter is trusted right up until it is ignored.

Write the test where it must speak: `kb ask "quantum teleportation scheduler"` against this
repository's corpus returns zero ranked matches and says so.

### B.4 Part B acceptance

- `npm run verify` green.
- `tags:` accepted on all six kinds; a non-list or non-slug value is a `kb verify` finding
  with a clear message.
- `kb ask "architecture layering"` against this repository surfaces `INV-DEP-DIRECTION` and
  `INV-MODULE-ENTRY`.
- `kb ask "the cli exited zero without checking"` surfaces `INC-0001`.
- The no-match case prints the negative report, with a test.
- Output is byte-identical across two consecutive runs.
- `AGENTS.md` §2 updated: `kb ask` is the cold-start move when no work item exists.

---

## 5. Part C — Promotion

> **Do not start until Part A is merged.** Part C writes into a pack.

### C.0 The gap

The `HAZ` kind is defined as a failure mode that happened *elsewhere*. Nothing can make one
arrive from elsewhere. The upstream loop carries `INC → report → upstream repository`; the
missing direction is `INC in project A → HAZ in my pack → seeded into projects B, C, D`.
That is, exactly, "accumulate the lessons from specific cases so the next project starts
knowing them."

### C.1 Surface

```
kb promote <INC-id> --to-pack <name> [--dry-run]
```

Reads the incident, writes a `HAZ-` document into the named pack's `hazard/` directory,
allocating the next free id in that pack. Built in the shape of `planUpstream`/`planOpenWork`
in `src/upstream.ts`: pure planner, thin apply, ids allocated from what the caller already
read off disk.

### C.2 What must be stripped — the boundary that matters

The incident lives in this repository and is full of it: `touches:` anchors at local files,
a body naming local modules, possibly absolute paths.

**A promoted hazard must contain none of that.** Specifically the plan function must:

- Force `holds_for: []`. An anchor is meaningless in the adopting repository; leaving one
  produces a document that dangles on arrival and trains its reader to ignore dangling
  anchors.
- Force `resolves_to: []` unless the named invariant is in `SHIPPED_INVARIANTS`, since any
  other id will not exist in the adopting repository.
- Carry no absolute path, no source excerpt, no diff, no file content, and no repository
  name. Purity does most of this for free: **the planner cannot read a file, so it cannot
  leak one.** Keep it that way — do not add a "helpful" code excerpt.
- Set `source:` to the origin the *owner* supplies, not a local path. Require it as a flag
  if the incident carries no upstream evidence.

Write the test that asserts a promoted document contains no `/` -prefixed or drive-lettered
path and no content from the incident's `touches:` files.

### C.3 The ceiling problem — resolve it as specified, do not discover it in review

`verify-hazard.ts` warns on any hazard with `resolution: open` older than
`hazard.openDays` (default 30), and `--strict` turns that into a failed build. The ceiling
is `hazard.ceiling` (default 24).

Therefore **a pack that seeds twenty open hazards fails the adopting repository's build
within thirty days of installation.** The lesson-sharing feature, built naively, is a time
bomb that makes every adopter switch off `--strict`. That is rule 8 of agent discipline
playing out exactly: a gate that blocks on bookkeeping is switched off within a week, and
then nothing is enforced.

The resolution, which you will implement rather than redesign:

- A hazard promoted into a pack is written with `resolution: not-applicable` and a `reason:`
  reading that it has not yet been triaged in this repository. `not-applicable` requires a
  `reason` and is off the clock — see `verify-hazard.ts`.
- `kb pack add` prints, at the end, a count of seeded hazards and one line: these arrive
  untriaged, and each must be moved to `open`, `guarded` or `accepted` deliberately.
- **`kb pack add` refuses to seed hazards that would exceed `hazard.ceiling`**, naming the
  count and the ceiling, and seeds none of them rather than a partial arbitrary subset.

If, while implementing, you conclude this resolution is wrong, **stop and report** with your
reasoning. Do not silently choose a different one, and do not raise `openDays` or `ceiling`
to make the problem go away.

### C.4 Part C acceptance

- `npm run verify` green.
- `kb promote INC-0001 --to-pack discipline --dry-run` prints the full document it would
  write and writes nothing.
- Promoting `INC-0001` produces a `HAZ-` document with empty `holds_for`, a `reason`,
  `resolution: not-applicable`, and no local path anywhere in it — with a test asserting the
  absence.
- Promoting the same incident twice does not allocate a second id; it reports the existing
  one. (`planUpstream` got this wrong once and reported its own report `missing` forever —
  see `docs/RESUME-LAYER31.md`.)
- Seeding a pack whose hazard count exceeds the ceiling refuses, names both numbers, and
  writes nothing.
- `kb verify --strict` clean in both this repository and a scratch adopter.

---

## 6. Out of scope for Layer 4

Do not build these, and do not leave stubs for them:

- Any network operation: pack registries, remote packs, `kb pack install <url>`, publishing.
- A pack dependency graph, version ranges, or conflict resolution beyond the duplicate-name
  error in §A.2.
- Embeddings, a vector store, or any persistent retrieval index.
- A seventh entity kind.
- Migrating `dicebound`. The Layer 3.1 anchor question is settled separately (Option A, 349
  anchors) and is not this layer's problem.
- Automatic promotion. `kb promote` is invoked by a person who has decided the lesson
  generalises. A tool that decides that on its own will fill the pack with noise, which is
  the ceiling problem arriving through the front door.

---

## 7. Reporting

Each part ends with a written report containing:

1. The actual output of `npm run verify` (last lines) and `kb verify --strict`.
2. The new entity/anchor counts, stated as numbers.
3. Every acceptance item in the part's list, each marked with what it printed.
4. Anything the plan got wrong. This plan was written without executing it; previous plans
   in this repository each contained three to five defects, and the ones that cost most were
   the ones an implementer worked around silently instead of reporting. A correction is a
   contribution, not a complaint.
