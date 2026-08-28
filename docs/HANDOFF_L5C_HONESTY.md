# Handoff — Layer 5, Part C: retrieval honesty

Copy everything below the line into the implementing agent.

---

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You write nowhere else
on this machine.

**Your task:** implement `docs/PLAN-LAYER5.md` **Part C (§5) only.** Parts A and B belong to
other agents; do not start them, do not stub them.

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER5.md` §1, §2, §5, §6, §7.
2. `src/ask.ts` and the `renderAsk` path in `src/render.ts`, in full.
3. `src/verify.ts`, `src/verify-hazard.ts` and `src/finding.ts` — how a finding chooses its
   severity, and how `--strict` turns severity into an exit code. §C.2 depends on that.
4. `templates/packs/discipline/doctrine/` — where the note in §C.2 about tags being a hint
   rather than a claim belongs.

**Confirm the baseline before you start:**

```
npm install && npm run verify
npm run kb -- verify --strict          # expect: kb verify: clean (31 entities, 264 anchors)
```

If either differs, stop and report. Do not start fixing.

**What Part C is.** Two places where the retrieval layer is quietly unfalsifiable.

`kb ask` reports what it found and says nothing about what it excluded. Measured today: this
repository has 9 invariants and `kb ask` returns all 9 on every query. Returning them all is
**correct** and must not change — an invariant that applies only when a keyword matches is
not an invariant. What is missing is the other half: the hazards it filtered, the entities
that scored zero, the kinds it did not search. A filter whose rejections are invisible cannot
be audited, and an unauditable filter is trusted right up until it is ignored.

`tags:` was added in Layer 4 as hand-maintained metadata with no checker. It is the single
place this project reintroduced the drift it exists to abolish: an anchor is verified, a tag
is not, and a misspelled tag fails silently by simply never matching anything.

**The four things most likely to go wrong here:**

- **Report counts and reasons, never the excluded entities themselves.** Listing what was
  filtered would reintroduce exactly the token cost this layer exists to remove. One line per
  category, counts only.
- **Do not start ranking invariants.** The temptation, once you are adding exclusion counts,
  is to trim the always-returned set. Resist it. Open hazards are in the same position and
  for the same reason — an unread hazard is worse than none, which is why the clock on them
  exists.
- **Give tags a closed list and a default, not a judgment.** Vocabulary declared in
  `anchoring.config.json` → out-of-vocabulary tag is an **error**. No vocabulary declared →
  a tag used exactly once in the whole corpus is a **warning**, because it is either a typo
  or a private note and neither is a shared vocabulary. Shape (lowercase slug) is an error in
  both modes; that is a format rule, not a judgment. Write the test where the singleton
  warning must *speak*.
- **The singleton warning must not fail `--strict`.** It is a hint about vocabulary quality,
  and a build that fails on it is a build people bypass. Assert the exit code is 0. The
  out-of-vocabulary error is the opposite case and *should* fail `--strict` — a declared
  vocabulary is a deliberate choice, and enforcing it is what makes declaring it worth
  anything.

**Determinism is not optional here.** `kb ask` output must stay byte-identical across two
consecutive runs against an unchanged corpus. Layer 5 §1 explains why this is a cost
mechanism and not a testing nicety: unstable output is a silent 10× multiplier.

**How to work.**

- `src/ask.ts` stays a pure domain module: no I/O, no clock except an injected one.
- One commit per coherent unit, conventional-commits format (`feat(ask): …`,
  `feat(verify): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote. Never edit
  `docs/origin/`, `anchoring.guards.mjs`, or `anchoring.depcruise.cjs` by hand.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead.

**When you finish**, write the report described in `docs/PLAN-LAYER5.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, every §C.3 acceptance item with what it
actually printed, and every defect you found in the plan. This plan was written without
executing it; reporting a defect is a contribution, not a complaint.
