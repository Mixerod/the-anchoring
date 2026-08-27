# Handoff prompt

Copy everything below the line into the implementing agent (Antigravity, Codex, another
Claude Code session — anything with filesystem and shell access on this machine).

---

You are working in the repository `D:\MyGitRepos\the-anchoring`. Set that as your working
directory before anything else.

**Your task:** execute `docs/PLAN.md` in this repository, tasks T1 through T6, in order.

**Read first, in this order, completely, before writing any code:**

1. `docs/PLAN.md` — the specification for your work. It is prescriptive: every naming
   decision, file format, function signature, validation rule, test requirement and commit
   message is already fixed there. Do not redesign any of it.
2. `docs/THE_ANCHORING.md` — the reasoning behind the pattern. Read it so your code comments
   and the documents you author in T6 are consistent with it. Do not modify this file.
3. `src/` — twelve modules and twelve test files, roughly 3,000 lines total. Read all of it
   before T1. It is dense but small, and every non-obvious decision is already explained in
   a comment. Preserve those comments; they are the record of what the failures cost.

**Confirm the baseline before you start.** `npm install && npm run typecheck && npm run test`
must give you 12 test files, 144 tests, all passing. If it does not, stop and report — do not
start fixing.

**What this project is.** A repository has three questions an agent needs answered: where the
code is, why it exists, and what is being built. A structural index (`codegraph`, an LSP)
answers the first. This tool answers the other two, with markdown documents in git carrying
YAML frontmatter, joined to code by *anchors* (`file:<path>` or `sym:<name>`, never line
numbers), re-checked on every run by `kb verify`. The code you are porting works and is
proven; it is simply welded to the project it was born in. Your job is to cut those welds
without changing behaviour.

**The rules that matter most** — `docs/PLAN.md` §3 has all ten, but these are the ones an
agent typically breaks:

- **Behaviour parity.** Output strings stay byte-identical to the baseline, except where they
  contained a hardcoded `.dicebound` path. If an existing test's expected text needs to
  change for any other reason, your code is wrong — fix the code, not the test.
- **Configuration is threaded, never global.** It is loaded once in `cli.ts` and passed down
  as a parameter. No module-level singleton, no lazy global, no `process.env` outside
  `cli.ts`. The existing code already does this for git, the symbol probe and the clock;
  match it exactly.
- **Only paths, patterns and thresholds become configurable.** The schema — the six entity
  kinds, `LINK_FIELDS`, `SCALAR_FIELDS`, `EDGE_PHRASE`, `HAZARD_RESOLUTIONS`, the two anchor
  forms — stays hardcoded. Do not generalise it.
- **One runtime dependency: `js-yaml`.** Do not add another.
- **Never run `npm publish`, `git push`, `gh repo create`, or add a git remote.** Packaging
  means ready-to-publish, not published.
- **Never edit anything under `D:\MyGitRepos\dicebound`** — it is a live project, and it is
  the reference you are porting *from*. Read it if you want; write to it never.
- **Never edit `docs/origin/`** — frozen provenance.
- Do not build anything in `docs/PLAN.md` §7 ("Explicitly out of scope"), especially any form
  of vector search or persistent index. That was researched and rejected on evidence; the
  reasoning is in `docs/THE_ANCHORING.md`.

**How to work.**

- Tasks are strictly sequential: T1 → T2 → T3 → T4 → T5 → T6. Do not start one before the
  previous is green.
- End every task with `npm run verify` passing and **exactly one** commit, using the commit
  message given in the plan for that task. Never batch two tasks into one commit.
- Write the tests the plan asks for, at the counts it states, before considering a task done.
  Every new behaviour needs a test; every validation rule listed in T2 needs coverage.
- If you hit something the plan genuinely does not cover, or the plan is wrong about the
  code: stop, write down the specific question and your recommended answer, and report it.
  Do not guess and continue, and do not silently change scope.

**When you are finished,** verify every checkbox in `docs/PLAN.md` §6 "Definition of done"
and report the result of each one — the actual command output, not an assertion that it
passed. Then report: the total test count and coverage, the six commit hashes, anything in
the plan you could not complete and why, and anything you found that the plan got wrong.
