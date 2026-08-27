# Handoff prompt — Layer 3.1

Copy everything below the line into the implementing agent.

---

You are working across **two** repositories on this machine:

- `D:\MyGitRepos\the-anchoring` — the tool. Start here.
- `D:\MyGitRepos\dicebound` — a live project on branch `phase-0`, the tool's first real
  adopter. You write to it only from Part C onward, and only the files the plan names.

**Your task:** execute `docs/PLAN-LAYER31.md` in `the-anchoring`, tasks T13 through T21, in
order.

**Read first, in this order, completely, before writing any code:**

1. `docs/PLAN-LAYER31.md` — the specification for your work. Prescriptive: every naming
   decision, file format, function signature, validation rule, test requirement and commit
   message is already fixed. Do not redesign any of it.
2. `docs/PLAN.md` §3 (ten non-negotiable rules) and §7 (out of scope), then
   `docs/PLAN-LAYER3.md` §1 and §4. All of it still binds you.
3. `docs/THE_ANCHORING.md` — the pattern and its reasoning. You add a section to it in T14;
   match its voice and its length.
4. `src/owners.ts` and `src/guards.ts` — T16 and T17 are built in the same shape as these
   two. Read both fully before starting Part B.

**Confirm both baselines before you start.** In `the-anchoring`: `npm install && npm run
verify` passes and `npm run kb -- verify -- --strict` prints
`kb verify: clean (24 entities, 193 anchors)`. In `dicebound`: `git status` is clean and
`pnpm -s kb verify` prints `kb verify: clean (107 entities, 369 anchors)`. If either differs,
stop and report — do not start fixing.

**What this batch is.** Three things that are really one. (A) Seven defects found auditing
the Layer 3 result; two of them produce wrong output for anyone who adopts the tool. (B) The
upstream loop: the tool has no channel from downstream pain to upstream fix, so a defect
found while using it elsewhere dies in that session. (C) Migrating Dicebound onto the
packaged tool — a 107-entity pnpm monorepo with a hand-written ESLint purity rule, an
existing dependency-cruiser config, 70 work items and a retired issue tracker. (C) is what
proves (B) is not theatre, and (C) will produce (B)'s first real inputs.

**The rules that get broken most often here:**

- **Default to `local`.** An incident is the project's fault until machine-checkable
  evidence says otherwise. You will feel pulled to attribute problems to the tool; the four
  evidence classes are closed and exist to stop that. If you finish Part D having classified
  everything as `upstream`, you have proven the discriminator is broken, not that the tool
  is bad — and you must say so in your report.
- **Purity is the redaction mechanism.** `planUpstream` and `planGuards` perform no I/O: no
  `node:fs`, no `node:child_process`, no `node:crypto`, no `new Date`. A pure function
  cannot leak a source file or a secret because it cannot read one. Keep it pure even when
  adding a "helpful" code excerpt would be easy. Reports must never contain file contents,
  diffs, or absolute paths.
- **No network, from any command, for any reason.** The upstream loop is carried by a person
  reading a file. That limit is the design, not an unfinished feature.
- **Fix the code, not the threshold.** T13(c) requires splitting a 656-line test file, not
  raising the 400-line ceiling. T19 requires renaming a mis-modelled field, not relaxing the
  validator that caught it. Loosening a check to make it pass is an automatic review failure.
- **No seventh entity kind.** `upstream_*` is a field plus a projection, exactly as `owners`
  is. `UP-` documents are generated artifacts, not entities: `loadStore` must not load them
  and `kb verify` must not check them.
- **In `dicebound`: keep `.dicebound/`.** Do not rename it to `.anchor/`. Do not edit any
  file the plan does not name. Do not push. `pnpm kb verify --strict` must still report
  exactly `107 entities, 369 anchors` — any deviation is a regression to investigate, never
  a new baseline.
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote, in either
  repository. Never edit `docs/origin/`.

**How to work.**

- T13 → T21, strictly sequential. Do not start one before the previous is green.
- End every task with `npm run verify` passing and **exactly one** commit, using the message
  the plan gives for that task. Tasks in Part C commit in `dicebound`; T19 commits in both,
  the tool first.
- Write the tests the plan asks for, at the counts it states, before considering a task done.
- If you hit something the plan genuinely does not cover, or the plan is wrong about either
  codebase: stop, write down the specific question and your recommended answer, and report
  it. Do not guess and continue. T20's third collision (`check-file-size.mjs`) has an
  explicit escape hatch — read it before you get there.

**When you are finished,** check every box in `docs/PLAN-LAYER31.md` "Definition of done"
and report the actual command output for each, not an assertion that it passed. Then report:
test count and coverage; every commit hash in both repositories; **how many incidents you
classified `local` versus `upstream`, and why**; anything you could not complete and why;
and anything either plan got wrong.
