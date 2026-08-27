# Layer 3.1 — corrections, the upstream loop, and the first real adopter

**Audience:** an autonomous coding agent. Read this file end to end before touching code.
Same standing as `docs/PLAN.md` and `docs/PLAN-LAYER3.md`: every naming decision, file
format, function signature, validation rule and acceptance test is already fixed. MUST and
MUST NOT are not preferences — a deviation fails review.

**Repositories — this plan touches two:**

| Path | Role |
|---|---|
| `D:\MyGitRepos\the-anchoring` | the tool. Parts A, B, D happen here. |
| `D:\MyGitRepos\dicebound` | the first real adopter. Part C happens here. **Branch `phase-0`, a live project.** |

Until Part C you MUST NOT write to `dicebound`. From Part C onward you MUST NOT write to
anything in `dicebound` outside the files this plan names.

**Prerequisites.** `docs/PLAN.md` T1–T6 and `docs/PLAN-LAYER3.md` T7–T12 complete. Verified
baseline at the time of writing:

```
the-anchoring   256 tests, verify+build green, kb verify --strict → 24 entities, 193 anchors
dicebound       pnpm kb verify → 107 entities, 369 anchors, clean
```

**Read first:** `docs/PLAN.md` §3 (all ten rules still bind) and §7, `docs/PLAN-LAYER3.md`
§1 and §4, then `docs/THE_ANCHORING.md`.

---

## 0. Why this batch is one batch

Three things that look separate are one thing:

1. Seven defects were found by auditing the Layer 3 result. They are small and they block
   nothing, but two of them (`CODEOWNERS` syntax, duplicated ESLint errors) produce wrong
   output for anyone who adopts the tool.
2. The tool has no channel from *downstream pain* to *upstream fix*. A defect found while
   using it in another repository dies in that repository's session.
3. The tool has exactly one user: itself. Dogfooding on a 40-file flat repository where the
   agent chose the layers to fit is the easy test. A 107-entity pnpm monorepo with a
   hand-written ESLint purity rule, an existing dependency-cruiser config, 70 work items and
   a retired issue tracker is the real one.

They are one batch because **(3) is what proves (2) works, and (3) will produce the first
real inputs for it.** The migration will find defects in the tool. Recording them through
the mechanism built in Part B, in the same batch, is the only way to know the mechanism is
not theatre.

---

## Part A — corrections

### T13 — the seven defects

One task, one commit. Every item has a test.

**(a) `CODEOWNERS` markers are not valid CODEOWNERS syntax.**
`src/owners.ts` writes `<!-- kb:owners:start -->`. In a `CODEOWNERS` file only `#` begins a
comment; GitHub parses that line as a pattern with two malformed owners and reports a
syntax error in its CODEOWNERS validator.

Split the marker constants by target format:

```ts
export const OWNERS_START_MARKER = '# kb:owners:start'
export const OWNERS_END_MARKER = '# kb:owners:end'
// AGENTS.md keeps the HTML pair — it is Markdown.
export const ARCHITECTURE_START_MARKER = '<!-- kb:architecture:start -->'
export const ARCHITECTURE_END_MARKER = '<!-- kb:architecture:end -->'
```

A `CODEOWNERS` that still carries the old HTML markers is treated as `stale` and rewritten
with the new pair, preserving every line outside them.

*Tests (≥4):* generated `CODEOWNERS` contains no `<!--`; hand-written lines outside the
markers survive a regeneration; a file with the old HTML markers is migrated exactly once;
`AGENTS.md` still uses the HTML pair.

**(b) One violation produces two identical ESLint errors.**
`planGuards` emits both `paths` and `patterns` entries for every module in `impureImports`.
The `patterns` group `['node:fs', 'node:fs/*']` already matches the bare specifier, so the
`paths` entry is pure duplication. Verified output:

```
1:1  error  'node:fs' import is restricted from being used. …
1:1  error  'node:fs' import is restricted from being used by a pattern. …
```

Emit `patterns` only. *Tests (≥2):* the generated block has no `paths` key; running ESLint
over a fixture that imports a restricted module yields exactly one error.

**(c) The file-size ceiling does not cover test files.**
`layers[].paths` name source files only, so `max-lines` never sees `*.test.ts`.
`src/config.test.ts` is 656 lines against a ceiling of 400. The upstream project kept the
**file** limit on tests deliberately and exempted only the **function** limit — a 900-line
test file is a real problem; a 200-line `describe` body is not.

Emit a second `max-lines` block covering `**/*.test.*` and `**/*.spec.*` at the same
ceiling, keeping `max-lines-per-function: 'off'` for them.

Then split `src/config.test.ts` along the seam the source already has: core/defaults/kind
validation stays in `config.test.ts`; everything testing the `architecture` block moves to
`config-architecture.test.ts`, mirroring `config.ts` / `config-architecture.ts`.
**Split the file. Do not raise the ceiling.**

*Tests (≥2):* the generated config contains a test-file `max-lines` block; both split files
are under the ceiling.

**(d) Coverage 94.95% against a 95% floor; 256 tests against a 260 floor.**
The whole shortfall is two uncovered I/O probes: `anchors.ts` 22.72% (lines 56–91,
`codegraphProbe`) and `git.ts` 18.18% (lines 19–28, `gitChangedFiles`).

Do not test them by spawning processes. Extract the pure half of each and test that, which
is what the rest of the codebase already does:

```ts
// anchors.ts
export function parseProbeOutput(stdout: string): boolean | undefined
// git.ts
export function parseChangedFiles(trackedStdout: string, untrackedStdout: string): readonly string[]
```

`codegraphProbe` and `gitChangedFiles` shrink to spawn-and-delegate and carry
`/* c8 ignore */`, the same treatment `cli.ts` already gives its process wiring.

*Tests (≥10):* `parseProbeOutput` for an array payload, a `{results:[]}` payload, a
`{symbols:[…]}` payload, empty output, malformed JSON, and a non-zero exit;
`parseChangedFiles` for staged-only, untracked-only, both, duplicates across the two,
blank lines, and sort order.

**(e) `src/invariants.test.ts` imports ESLint, which the Layer 3 Definition of Done forbade
outright.** The import is correct — the plan itself required a test proving the generated
rule fires — and the prohibition was too broadly worded. Restate it in
`docs/PLAN-LAYER3.md` §3 as: *no import of ESLint or dependency-cruiser outside `*.test.ts`*,
and add a one-line comment in `invariants.test.ts` recording why the import is there.
Changing a rule to match reality is legitimate **only** when the rule was wrong; the code
here was right.

**(f) `kb init --guards` writes an incomplete `architecture` block.** It emits `layers` and
omits `maxFileLines`, `maxFunctionLines`, `entryPoints`, `moduleRoots`, `impureImports`,
leaving them to implicit defaults. `docs/PLAN.md` T4 step 6 requires every value be written
out explicitly, because a generated config is documentation. Write all of them.
*Test (≥1):* the generated config contains all six keys.

**(g) `.githooks/pre-commit` runs `kb verify` but not `kb guards --check`.** A stale
generated file should be caught before the commit, not in CI. Add it.

**Acceptance:** `npm run verify` green; coverage ≥95% on `src/`; test count ≥270; no file in
`src/` over 400 lines; `kb owners --check` green and `.github/CODEOWNERS` free of `<!--`.

**Commit:** `fix: seven defects found auditing the Layer 3 result`

---

## Part B — the upstream loop

### T14 — the principle, in the spec

Everything in Part B implements one idea, and the idea belongs in
`docs/THE_ANCHORING.md`, not only in code. Add a section titled **"The upstream loop"**,
placed after "Every claim is machine-checked" and before "The four commands".

It must say, in the spec's own voice and at its own length (roughly 200–300 words):

- **The problem.** A pattern used in more than one repository accumulates defects that are
  only ever visible downstream. The upstream repository never sees them. The downstream
  repository has no channel that outlives the session in which the defect was hit, so the
  knowledge dies where it was earned — the same failure this whole pattern exists to stop,
  one level up.
- **The signal nobody else has.** A bug tracker records what someone remembered to report.
  A tool with gates knows something stronger: **when its own gate ran and stayed silent.**
  That absence is invisible to every other mechanism, and it is the highest-value evidence
  that the tool, not the project, is at fault.
- **The rule.** Attribution runs on closed evidence classes, and the default verdict is
  `local`. An incident is the project's fault until machine-checkable evidence says
  otherwise. State plainly why: an agent asked "is this the tool's fault?" will say yes far
  more often than it should, and an attribution mechanism that cannot say *no* is a
  mechanism that reports noise until it is switched off.
- **It generalises.** `upstream:` names any package. A company with five internal shared
  libraries gets the same loop for each of them at no extra cost. This is not a feature the
  tool has for its own benefit.
- **No network, ever.** The tool writes a document; a person reads it and decides whether to
  send it. That is a deliberate limit, not an unfinished feature: an automatic channel from
  a private repository to an upstream project is a data-exfiltration path with a friendly
  name.

Add to **"Rules that are not optional"** a sixth entry:

> 6. **An incident blamed upstream carries machine-checkable evidence, or it is local.**

**Commit:** `docs(spec): add the upstream loop to the pattern`

---

### T15 — the schema

**No seventh entity kind.** This is a field plus a projection, exactly as `kb owners` is a
field plus a projection rather than a `TEAM-` kind. `docs/PLAN.md` §7 stands.

Extend `SCALAR_FIELDS.INC` with: `upstream`, `upstream_verdict`, `upstream_evidence`,
`upstream_gate`, `upstream_rejected`, `upstream_recorded`, `upstream_work`.

```yaml
# .anchor/incident/INC-0007.md
upstream: the-anchoring          # package suspected; any package name, not only this one
upstream_verdict: upstream       # local (default) | upstream | unclear
upstream_evidence: silent-gate   # required when verdict is `upstream`
upstream_gate: done              # required for silent-gate: verify | done | guards | owners
upstream_recorded: 2026-08-28    # required when verdict is `upstream`
upstream_work: W-13              # filled by --open-work; never by hand
```

**The four evidence classes. This list is closed.** Add `EVIDENCE_CLASSES` to `model.ts`
next to `HAZARD_RESOLUTIONS`, with a doc comment stating that a fifth class must not be
added without a new ADR — the closedness is the mechanism, not an implementation detail.

| Class | Means | Checked by `verify` |
|---|---|---|
| `silent-gate` | a gate ran and stayed silent when it should have spoken | `upstream_gate` names one of the four commands |
| `generated-artifact` | the defect is in a file the tool generated | at least one `touches:` anchor resolves under `kbRoot` or matches `anchoring.*` |
| `shipped-invariant` | a shipped invariant was wrong or insufficient | `violates:` names one of the five shipped `INV-` ids |
| `schema-gap` | the schema cannot express what had to be expressed | `upstream_rejected` carries the frontmatter snippet that was refused |

Everything stays in frontmatter. `store.ts` never reads a document body and this must not
change it.

**Validation — new `checkUpstream(entity, config, now)` in `verify.ts`,** built like
`checkHazard`:

- `upstream_verdict` absent → treated as `local`, nothing else is required
- a value outside `local | upstream | unclear` → error listing the three
- verdict `upstream` or `unclear` with no `upstream` package name → error
- verdict `upstream` with no `upstream_evidence`, or one outside the four classes → error
- each class's own requirement above unmet → error naming the missing field
- verdict `upstream` with no valid `upstream_recorded` ISO day → error
- verdict `upstream`, `upstream_recorded` older than `UPSTREAM_OPEN_DAYS` (60), and no
  `upstream_work` → **warning** (so `--strict` fails CI). A loop nobody closed must make
  noise; an unread `UP-` is worse than none, for the same reason an unread hazard is.
- more than `UPSTREAM_CEILING` (12) incidents at verdict `upstream` without
  `upstream_work` → error. Same argument as the hazard ceiling: an unbounded backlog of
  other-people's-bugs is a graveyard.

*Tests — new `src/upstream-schema.test.ts`, ≥16:* one per rule above; absent verdict is
silent; `local` requires nothing; a valid document of each of the four classes passes; the
60-day clock warns at 61 and not at 59; the ceiling errors at 13 and not at 12.

**Commit:** `feat(upstream): record and validate upstream attribution on incidents`

---

### T16 — `kb upstream`

**Create `src/upstream.ts`.** Same plan/apply split, same purity rule as `guards.ts`.

```ts
export interface UpstreamReport {
  readonly id: string            // UP-0001
  readonly about: string         // INC-0007
  readonly path: string          // <kbRoot>/upstream/UP-0001.md
  readonly body: string
}
export interface UpstreamPlan {
  readonly reports: readonly UpstreamReport[]
  readonly notes: readonly string[]
}
export function planUpstream(config: AnchoringConfig, store: Store, pkg: PackageFacts): UpstreamPlan
export function upstreamHash(body: string): string
export function checkUpstream(plan: UpstreamPlan, read: (p: string) => string | undefined): readonly FileState[]
```

`PackageFacts` is `{ name: string; version: string }`, read in `cli.ts` from the installed
package and **passed in**. `planUpstream` performs no I/O: no filesystem, no git, no clock,
no `node:crypto`.

**Purity is the redaction mechanism.** State this in the module doc comment. `planUpstream`
cannot leak a source file, a diff, or a secret, because it cannot read one. That is a
stronger guarantee than a filter, and it is why this module must stay pure even when adding
a "helpful" excerpt would be easy. A test asserts `upstream.ts` imports none of `node:fs`,
`node:child_process`, `node:crypto`.

**What a report may contain — this list is exhaustive:**

- package name and version
- the `architecture` block from `anchoring.config.json`, verbatim
- the gate that stayed silent, when the class is `silent-gate`
- the incident's `id`, `title`, `status`, its `upstream_*` fields, and its `touches:` anchors
  **as paths**
- for `schema-gap`, the `upstream_rejected` snippet, which the author wrote by hand
- a fixed banner: `Review this file before sending it anywhere. It leaves your machine only
  if you carry it.`

**Never:** file contents, diffs, git history, environment variables, absolute paths, branch
names, the downstream repository's filesystem location. The downstream repository is
identified by its directory name only.

**Report shape.** `<kbRoot>/upstream/UP-000N.md`. These documents are **generated
artifacts, not entities** — `loadStore` must not load them, and `kb verify` must not check
them. `kbRoot/upstream/` is excluded from every kind's directory by construction. They carry
the same generated header as `anchoring.*` files, plus:

```markdown
---
id: UP-0001
about: INC-0007
package: the-anchoring
package_version: 0.1.2
evidence: silent-gate
status: draft
---
```

`status` is the one field a human edits: `draft` → `sent` → `accepted` | `declined`. So
`upstreamHash` is computed over the body with the `status:` line normalised to `draft` and
everything from the `## Notes` heading onward stripped. A person may change the status and
append notes without the file reading as `hand-edited`; changing anything else does trip it.
Specify this in a comment — it is the non-obvious part.

The body ends with a fenced block containing a ready-to-paste prompt for an upstream agent:
what happened, which gate was silent, the evidence class, what to investigate first, and an
instruction to reproduce before fixing.

**CLI:**

```
kb upstream               generate a UP- for every incident at verdict `upstream` lacking one
kb upstream --check       CI gate: exit 1 on missing / stale / hand-edited, or an unclosed loop
kb upstream --dry-run     print bodies, write nothing
kb upstream --list        table of incidents by verdict, with the reason each was not escalated
```

`--list` must show the `local` and `unclear` rows too. A tool that only ever displays what
it escalated cannot be audited for over-attribution, and over-attribution is this feature's
main failure mode.

*Tests — new `src/upstream.test.ts`, ≥18:* one report per evidence class; no report for
`local` or `unclear`; ids allocate sequentially and skip existing ones; the banner is
present; a report contains no absolute path (assert against a regex for `[A-Za-z]:\\` and a
leading `/`); the hash ignores a changed `status` and an appended `## Notes`; the hash
changes when any other line changes; `--check` returns each of the four states; `--dry-run`
writes nothing (`InitIo.writeFile` throws); `--list` includes `local` rows;
`planUpstream` is pure (grep-equivalent assertion in `invariants.test.ts`).

**Surface it where the agent already looks:** when `kb done` runs and any incident sits at
verdict `unclear`, or at `upstream` with no `upstream_work`, append one yellow line naming
the incident. One line, never an error, never a failed turn — the rule the Stop hook has
followed since INC-0001.

**Commit:** `feat(upstream): project attributable incidents into reviewable reports`

---

### T17 — `--open-work`

```
kb upstream --open-work <path-to-upstream-repo>
```

Opens a work item in the upstream repository so the report does not depend on anyone
remembering. Approved scope: **generate the report, open the work item, stop.** The agent
does not fix the upstream code.

Behaviour:

1. `<path>` must contain an `anchoring.config.json` whose repository provides the package
   named in the report. Refuse otherwise, naming both the expected and the found package.
2. Refuse if the upstream repository has uncommitted changes — writing into somebody's
   work in progress is how a helpful tool becomes an unwelcome one. This check lives in
   `cli.ts`, the I/O layer, never in `upstream.ts`.
3. Refuse if a work item already references this `UP-` id. Idempotent by construction.
4. Write **one** file: the next free `W-<n>` in the upstream repo's `WORK.dir`, `status:
   todo`, titled from the report, its body naming the `UP-` id and the **directory name** of
   the downstream repository — never its path.
5. Write `upstream_work: W-<n>` back into the **downstream incident**, which is
   hand-editable, never into the generated `UP-` file.
6. Commit nothing, in either repository. Print both paths written.

**MUST NOT:** edit any other file in the upstream repository, run its tests, install
anything, push, or open a pull request.

*Tests — ≥10:* package mismatch refuses; a dirty upstream tree refuses; a duplicate `UP-`
reference refuses; the work item lands in the configured `WORK.dir` with a free id; the
incident gains `upstream_work`; the `UP-` file is byte-identical afterwards; the body
carries no absolute path; nothing else in the upstream tree is touched (snapshot the
directory listing before and after); running it twice writes nothing the second time.

**Commit:** `feat(upstream): open the work item in the upstream repository`

---

## Part C — Dicebound, the first real adopter

From here you write to `D:\MyGitRepos\dicebound`, branch `phase-0`.

**Before the first edit:** `git -C D:/MyGitRepos/dicebound status` must be clean. If it is
not, stop and report. Commit in Dicebound after each of T18, T19, T20, with the messages
given. Do not push.

### T18 — install the package and cut `tools/kb` over

1. `pnpm add -D link:../the-anchoring` at the Dicebound root. `link:` because the package is
   unpublished; a note in the commit message must record that this becomes a version range
   on publication.
2. Delete `tools/kb/` entirely. It is vendored source with no history worth keeping — the
   history is in `the-anchoring`.
3. Root `package.json`: `"kb": "kb"` and `"check:kb": "kb verify"`.
4. Write `anchoring.config.json`:

```jsonc
{
  "kbRoot": ".dicebound",
  "kinds": {
    "ADR":  { "dir": "docs/adr" },
    "INV":  { "dir": ".dicebound/invariant" },
    "FLOW": { "dir": ".dicebound/flow" },
    "WORK": { "dir": ".dicebound/work" },
    "INC":  { "dir": ".dicebound/incident" },
    "HAZ":  { "dir": ".dicebound/hazard" }
  },
  "governedPaths": ["packages/", "apps/", "scripts/"],
  "hazard": { "openDays": 30, "ceiling": 24 },
  "symbolIndex": "none"
}
```

**Keep `.dicebound/`. Do not rename it to `.anchor/`.** 107 entities, 70 work items and
every anchor path would churn for no behavioural gain, and the rename would bury the real
migration diff. The configurable `kbRoot` exists precisely so this rename is unnecessary.

`symbolIndex: "none"` is correct and verified: Dicebound has no `.codegraph` directory, and
every `sym:` occurrence in the repository is prose inside a document body, not a frontmatter
anchor. If either fact has changed by the time you run this, re-check before setting it.

**Acceptance — exact, not approximate:** `pnpm kb verify --strict` must print

```
kb verify: clean (107 entities, 369 anchors)
```

Any deviation in either number is a regression in the port, not a new baseline. Investigate
it, do not accept it. If a genuine defect in the tool caused it, that is Part D's first
incident — record it, do not paper over it.

**Commit (dicebound):** `refactor(kb): replace vendored tools/kb with the-anchoring package`

---

### T19 — the `owner:` collision

**The finding.** All 70 Dicebound work items carry `owner:`, with values `claude` (30),
`agent` (24), `unassigned` (7), `owner` (5), `antigravity` (4). None matches the
`@handle` / `team:<name>` shape that T11 validates. Every one of them fails.

**The diagnosis, which matters more than the fix.** That field never meant ownership in the
CODEOWNERS sense. It records *which agent executed the work*. Two concepts wearing one name
— exactly what "one concept, one name, everywhere" forbids, caught by a validator rather
than by a reader, which is the pattern working as designed.

**The fix.**

1. Rename the field to `executed_by:` across all 70 files. Mechanical; verify the count
   before and after.
2. Add `executed_by` to `SCALAR_FIELDS.WORK` in `the-anchoring` as a free string with no
   shape constraint — it names a tool, not a person, and constraining it would repeat the
   mistake in the other direction. This is a change to the tool: make it in the
   `the-anchoring` repository, in its own commit, before the Dicebound edit.
3. Set `owner: @Mixerod` on the ADRs only. Leave work items without an `owner`.
4. **Do not relax the `owner` shape validation.** An ownership field that accepts anything
   identifies nobody. The validator found a real modelling error; weakening it to make the
   error disappear discards the finding.

**Also: the retired tracker.** 57 work items still carry `linear:` and `linear_url:`. Linear
was retired in favour of `.dicebound/work/`. Drop `linear_url:` — a URL into a decommissioned
tracker is documentation that lies, and nothing anchors it so no gate can catch it. Keep
`linear:` as a historical id, and add one line to `.dicebound/README.md` recording what it
was and that the tracker is gone.

**Acceptance:** `pnpm kb verify --strict` still reports 107 entities, 369 anchors, clean.
`grep -c "^owner:" .dicebound/work/*.md` returns nothing. `pnpm kb owners` produces a
`CODEOWNERS` covering the ADR-anchored paths and no work-item noise.

**Commits:** `feat(model): add executed_by for the agent that did the work` (the-anchoring),
then `refactor(kb): separate executed_by from owner, drop dead Linear URLs` (dicebound)

---

### T20 — architecture and guards for Dicebound

Dicebound is `apps/{web,server-do,server-lan}` and `packages/{core,sim,cli}`, with
cross-package imports by package name (`@dicebound/core`), never by relative path.

Add to `anchoring.config.json`:

```jsonc
"architecture": {
  "layers": [
    { "name": "clients", "paths": ["apps/web/", "apps/server-do/", "apps/server-lan/", "packages/cli/"] },
    { "name": "sim",     "paths": ["packages/sim/"] },
    { "name": "core",    "paths": ["packages/core/"], "pure": true }
  ],
  "moduleRoots": ["packages/", "apps/"],
  "entryPoints": ["src/index.ts", "index.ts"],
  "maxFileLines": 800,
  "maxFunctionLines": 50,
  "impureImports": ["node:fs", "node:child_process", "node:http", "node:https", "node:crypto"]
}
```

Verify `entryPoints` against what each package actually exposes (`main` / `exports` in its
`package.json`) before trusting the values above.

**Composition — three real collisions, each handled explicitly:**

1. `.dependency-cruiser.cjs` already defines `no-circular`, and the generated fragment
   defines it too. Duplicate rule names in one dependency-cruiser config are a configuration
   error. **Remove the local `no-circular`**, keep the generated one, and keep both bespoke
   rules (`core-must-not-import-other-packages-or-apps`,
   `no-apps-internal-package-imports`) after the spread.
2. `eslint.config.js` carries a hand-written core-purity block (`no-restricted-globals` for
   `Date`/`fetch`/`crypto`, `no-restricted-properties` for `Math.random`/`Date.now`,
   `no-restricted-imports`, `no-console`) that overlaps the generated pure-layer block.
   Spread `anchoringGuards` **first**, keep the bespoke block after so it wins where they
   differ. Do not delete it: it also bans `react*` and `*server*`, which the generator does
   not express.
3. `scripts/check-file-size.mjs` (244 lines, TypeScript AST, 800/50) overlaps the generated
   `max-lines` rules. Two checkers that must be kept in agreement are a drift source.
   **Retire the script**, remove `check:size` from `package.json` and from CI, and re-anchor
   any `INV-` that pointed at it. **Escape hatch:** if retiring it produces more than ten new
   findings that the ESLint rules did not previously catch, stop — keep the script, restore
   the CI step, and record an incident plus an upstream report saying the generator is not
   yet a replacement. That is a legitimate outcome, not a failure.

CI, in this order, after the existing steps: `pnpm kb guards -- --check`,
`pnpm kb owners -- --check`, `pnpm kb upstream -- --check`, `pnpm kb verify -- --strict`.

**Acceptance:** `pnpm verify`, `pnpm exec depcruise packages apps`, `pnpm exec eslint .` all
pass; `pnpm kb guards --check` exits 0; the entity and anchor counts are unchanged.

**Commit (dicebound):** `feat(kb): enforce the architecture with generated guards`

---

## Part D — close the loop

### T21 — file the reports the migration actually produced

Part C will have found defects in the tool. Record each one properly, in Dicebound, and
carry it upstream with the mechanism Part B built. This is the acceptance test for Part B,
and it is the reason the batch is a batch.

For each defect:

1. Write `.dicebound/incident/INC-000N.md` — what happened, root cause, prevention, with
   real `touches:` anchors.
2. Classify honestly. **Default to `local`.** Only reach for `upstream` when one of the four
   evidence classes actually applies, and record which. If none applies, the verdict is
   `unclear` and no report is generated. Resist the pull to escalate: a batch that
   attributes everything upstream has proven nothing except that the discriminator does not
   discriminate.
3. `pnpm kb upstream` to generate the report; read it and confirm it contains no file
   contents and no absolute paths.
4. `pnpm kb upstream --open-work ../the-anchoring` for the ones that survive classification.

**At least one incident is already known** and must be filed: the `owner:` collision from
T19. Its class is `schema-gap` — the schema forced two concepts (who owns this code, which
agent executed this task) into one field, and `upstream_rejected` carries a frontmatter
snippet the validator refused. Its fix, `executed_by`, is already applied in T19, so the
work item opened upstream is a record of a closed loop rather than an open request. That is
what a healthy loop looks like most of the time.

**Acceptance:**
- every incident filed has a verdict, and every `upstream` verdict names an evidence class
- `pnpm kb upstream --list` shows the `local` and `unclear` rows as well as the escalated ones
- `pnpm kb upstream --check` exits 0 in Dicebound
- each opened work item exists in `the-anchoring`'s `.anchor/work/` and `kb verify --strict`
  is clean there
- **report honestly how many incidents you classified `local` versus `upstream`.** If every
  one came out `upstream`, say so and explain, because that is evidence the discriminator is
  broken, not evidence the tool is bad.

**Commits:** `docs(incident): record what the migration found` (dicebound), then
`docs(work): accept the upstream reports from the first adopter` (the-anchoring)

---

## Definition of done

**the-anchoring**
- [ ] `npm run verify` and `npm run build` green
- [ ] test count ≥ 320, line coverage ≥ 95% on `src/`
- [ ] `dependencies` is exactly `{ "js-yaml": "^4.1.0" }`
- [ ] `grep -rn "node:fs\|node:child_process\|node:crypto\|new Date" src/upstream.ts src/guards.ts` → no matches
- [ ] `kb guards --check`, `kb owners --check`, `kb upstream --check`, `kb verify --strict` all exit 0
- [ ] `.github/CODEOWNERS` contains no `<!--`
- [ ] no file in `src/` over 400 lines
- [ ] `docs/THE_ANCHORING.md` carries the upstream-loop section and the sixth non-optional rule

**dicebound**
- [ ] `tools/kb/` deleted; the package installed via `link:`
- [ ] `pnpm kb verify --strict` → **107 entities, 369 anchors, clean**
- [ ] `pnpm verify`, `depcruise`, `eslint` all pass with the generated guards composed in
- [ ] no `owner:` on any work item; `executed_by:` on all 70; no `linear_url:` anywhere
- [ ] CI runs the four `kb` gates
- [ ] every defect found during migration is an incident with a verdict

**both**
- [ ] nothing published, nothing pushed, no git remote added anywhere
- [ ] no file in `dicebound` edited outside the ones this plan names

## Still out of scope

Everything in `docs/PLAN.md` §7 and `docs/PLAN-LAYER3.md` §4, unchanged, plus:

- Any network call, from any command, for any reason. The upstream loop is carried by a
  person.
- The agent fixing the upstream repository. It generates a report and opens a work item; a
  human decides what happens next.
- A fifth evidence class. Adding one requires a new ADR in `the-anchoring` arguing why the
  four were insufficient — the closedness is the mechanism.
- Renaming `.dicebound/` to `.anchor/`.
- Publishing to npm. That waits until Dicebound has run on the packaged version for a full
  phase, exactly as `docs/THE_ANCHORING.md` says.
