# Handoff — Layer 5, Part A: `kb brief`, delta verify, no-progress

Copy everything below the line into the implementing agent.

---

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You write nowhere else
on this machine.

**Your task:** implement `docs/PLAN-LAYER5.md` **Part A (§3) only.** Parts B and C belong to
other agents; do not start them, do not stub them.

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER5.md` §1, §2, §3, §6, §7. §1 is not background — it contains the
   mechanism the whole part is built around, and you will make wrong calls without it.
2. `docs/THE_ANCHORING.md` — the pattern and why it refuses indexes and caches.
3. `src/render.ts`, `src/ask.ts`, `src/store.ts` — `kb brief` renders from the same corpus
   these read, and must read like a sibling of `kb ask`.
4. `src/git.ts` and `src/loader.ts` — `--since` needs git, and git is infra. The domain half
   receives a changed-path list as an argument.
5. `.anchor/incident/INC-0001.md` — the failure mode this part is defending against, in its
   original form.

**Confirm the baseline before you start:**

```
npm install && npm run verify
npm run kb -- verify --strict          # expect: kb verify: clean (31 entities, 264 anchors)
```

If either differs, stop and report. Do not start fixing.

**What Part A is.** Everything this tool emits today is sized and ordered for a human reading
a terminal. An agent pays for that arrangement on every call. Prompt caching is a prefix
match with at most four breakpoints, so a context bundle arranged most-stable-first and
ordered deterministically costs roughly an eighth of one that is not. You are building that
bundle (`kb brief`), the delta form that keeps it stable across loop iterations
(`kb verify --since`), and the detector that notices when a loop has stopped making progress.

**The five things most likely to go wrong here:**

- **A moving number in tier 1, 2 or 3 destroys everything after it.** `(31 entities, 264
  anchors)`, a timestamp, a git SHA, a duration — any of these in a stable tier means every
  commit invalidates the cache from that point on, silently, forever. All of it belongs in
  tier 4. Write the test that asserts tiers 1–3 contain no count-derived digits.
- **Never order by filesystem.** A `readdir` result is not a guaranteed order and will differ
  on another machine. Sort by kind (in the documented tier order), then by id ascending, with
  a plain codepoint comparison. Byte-identical output is not a testing nicety here — **it is
  the cache-hit condition.** Unstable order is a 10× cost multiplier applied in silence.
- **Do not claim what the tool cannot observe.** This tool never calls a model, so it cannot
  verify a cache hit. It guarantees byte-stability; the harness verifies the hit by reading
  `usage.cache_read_input_tokens`. Say exactly that in the docs and do not blur it.
- **Empty output is a defect, not a result.** `kb verify --since <ref>` with no changed paths
  must print "no entities changed since `<ref>`" in words. A command that checks nothing and
  prints nothing is indistinguishable from a broken one — that is `INC-0001`, and this
  repository has already paid for it once.
- **No-progress detection warns and never fails the turn**, not even under `--strict`. A
  loop-detector that blocks a commit is one that gets uninstalled within a week, and then
  nothing is enforced at all. Put that reasoning in the code comment, not just in the plan,
  so the next person does not "tighten" it.

**On state.** No-progress detection needs memory across runs. `${kbRoot}/session/` is already
gitignored and is already the established home for ephemeral state — use it. Do not add a
cache anywhere in the pure core; `kb brief` renders from the corpus every time, and that is
the design, not an optimisation left undone.

**How to work.**

- Pure planner, thin apply. New domain modules do no I/O and read no clock; register them in
  the layer matrix in `anchoring.config.json` and run `kb guards` to regenerate the
  fragments. Never hand-edit `anchoring.guards.mjs` or `anchoring.depcruise.cjs`.
- One commit per coherent unit, conventional-commits format (`feat(brief): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote. Never edit
  `docs/origin/`.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead.

**When you finish**, write the report described in `docs/PLAN-LAYER5.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, every §A.5 acceptance item with what it
actually printed, **the byte size of `kb brief` output and of each tier as numbers**, and
every defect you found in the plan. This plan was written without executing it; each previous
plan in this repository contained three to five defects. Reporting one is a contribution.
