# Handoff prompt — Layer 3

Copy everything below the line into the implementing agent.

---

You are working in the repository `D:\MyGitRepos\the-anchoring`. Set that as your working
directory before anything else.

**Your task:** execute `docs/PLAN-LAYER3.md` in this repository, tasks T7 through T12, in
order.

**Read first, in this order, completely, before writing any code:**

1. `docs/PLAN-LAYER3.md` — the specification for your work. Prescriptive: every naming
   decision, file format, function signature, validation rule, test requirement and commit
   message is already fixed there. Do not redesign any of it.
2. `docs/PLAN.md` — the previous plan, already executed. Its §3 "Non-negotiable rules" still
   binds you, all ten, and its §7 "Explicitly out of scope" still binds you in full.
3. `docs/THE_ANCHORING.md` — the reasoning behind the pattern. Read it so the invariant
   documents you author in T9 and the `AGENTS.md` you write in T10 are consistent with it.
   Do not modify this file.
4. `src/config.ts`, `src/init.ts`, `src/cli.ts` — you extend all three. Read them fully.
   Every non-obvious decision already carries a comment explaining it; preserve those
   comments, they are the record of what the failures cost.

**Confirm the baseline before you start:** `npm install && npm run verify` must pass, and
`npm run kb -- verify -- --strict` must print `kb verify: clean (12 entities, 36 anchors)`.
If not, stop and report — do not start fixing.

**What Layer 3 is.** The tool already enforces that a document's claim about code is *true*.
It states that an invariant without a checker is a wish — but it ships no checker, so every
adopting repository has to hand-write dependency-direction, no-cycles, module-entry-point,
purity and file-size rules, which in practice means nobody writes them and the slot stays
empty. Layer 3 fills the slot: it generates checker configuration from a dependency matrix
declared in `anchoring.config.json`, ships five starter invariants that point at what it
generated, ships an `AGENTS.md` that makes an agent actually run the four commands, and
projects ownership out of the graph into `CODEOWNERS`.

**The single most important design rule — everything follows from it:**

> `the-anchoring` **generates** checker configuration. It never **runs** a checker, and it
> never **depends on** one.

Concretely: `dependencies` stays exactly `{ "js-yaml": "^4.1.0" }`. ESLint and
dependency-cruiser must not appear as dependencies, peer dependencies, or optional
dependencies, and must not be imported anywhere in `src/`. The generated files are named
`anchoring.guards.mjs` and `anchoring.depcruise.cjs`; the tool prints the two lines a host
must add to compose them, and never performs that edit itself. Do not "helpfully" merge into
`eslint.config.js`, `.dependency-cruiser.cjs` or `package.json` — a tool that silently edits
files the host owns is a tool people uninstall.

**Other rules that get broken most often:**

- `planGuards` and `guardsHash` are **pure**: no filesystem, no clock, no `node:crypto`, no
  process. The hash is a dependency-free FNV-1a over canonical JSON. This is what lets the
  generator be tested in milliseconds and is checked in the Definition of Done.
- Configuration is threaded as a parameter, never a module-level singleton. Same as the rest
  of the codebase.
- `architecture` absent from the config means guards are **off**. Never invent a dependency
  matrix for a repository that has not declared one — refuse with an example instead.
- Never raise a threshold to make a check pass. In T12 the generated guards will fail on this
  repository's own code (`src/config.ts` is 392 lines against a 400 ceiling). Fix the code.
  Loosening the limit in the tool that exists to stop people loosening limits is
  self-refuting, and it is an automatic review failure.
- Never edit a generated `anchoring.*` file by hand, at any point, for any reason.
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote.
- Never edit anything under `D:\MyGitRepos\dicebound` or `docs/origin/`.
- Do not build anything in `docs/PLAN-LAYER3.md` §4 or `docs/PLAN.md` §7. In particular: no
  generators for non-JS ecosystems, no auto-fixing of violations, no `TEAM-` entity kind, no
  vector search.

**How to work.**

- T7 → T8 → T9 → T10 → T11 → T12, strictly sequential. Do not start one before the previous
  is green.
- End every task with `npm run verify` passing, `npm run kb -- verify -- --strict` clean, and
  **exactly one** commit using the message given in the plan for that task.
- Write the tests the plan asks for, at the counts it states, before considering a task done.
  T8 in particular requires that the generated `.mjs` is proven syntactically valid by
  importing it — a generator that emits a syntax error must fail in your test suite, not in
  an adopter's build.
- If you hit something the plan genuinely does not cover, or the plan is wrong about the
  code: stop, write down the specific question and your recommended answer, and report it.
  Do not guess and continue, and do not silently change scope. T12 step 1 contains one such
  decision point already flagged — read it before you get there.

**When you are finished,** check every box in `docs/PLAN-LAYER3.md` §3 "Definition of done"
and report the actual command output for each, not an assertion that it passed. Then report:
total test count and coverage, the six commit hashes, anything you could not complete and
why, and anything the plan got wrong.
