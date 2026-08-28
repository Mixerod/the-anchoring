# Handoff — Layer 4, Part A: Packs

Copy everything below the line into the implementing agent.

---

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You do not write
anywhere else on this machine. In particular you **read** `~/.claude/rules/personal/*.md` and
you **never write to `~/.claude/`** — not to edit, not to tidy, not to delete.

**Your task:** implement `docs/PLAN-LAYER4.md` **Part A (§3) only.** Parts B and C belong to
other agents; do not start them, do not stub them.

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER4.md` §1, §2, §3, §6, §7. §3 is your specification. Naming, signatures,
   file formats and acceptance criteria are already fixed — do not redesign them.
2. `docs/THE_ANCHORING.md` — the pattern and why it is shaped this way.
3. `src/guards.ts` and `src/init.ts`, in full. Part A is built in the same shape as these
   two: a pure planner, a thin apply, a generated header with a hash, a drift check with a
   four-state union. You are extending an established pattern, not inventing one.
4. `src/upstream.ts` — specifically `upstreamHash` and `hashableBody`. Your `packHash` must
   match that canonicalisation rather than invent a second one.

**Confirm the baseline before you start:**

```
npm install && npm run verify          # expect 364 tests passing, typecheck/lint/depcruise clean
npm run kb -- verify --strict          # expect: kb verify: clean (26 entities, 196 anchors)
```

If either differs, stop and report. Do not start fixing.

**What Part A is.** Everything the tool does today makes one repository legible; every
anchor is `file:src/foo.ts` and means nothing elsewhere. A *pack* is the unit in which
engineering knowledge travels **between** repositories: invariants any project should hold,
hazards learned elsewhere, and doctrine prose that cannot be machine-checked. You are
building the format, the resolver, the seeder, the drift check, and the first pack.

**The five things most likely to go wrong here:**

- **You will be tempted to write to `~/.claude/`.** The first pack's content lives there, and
  the obvious "finish the job" move is to replace those three files with a pointer. Do not.
  Read them, build the pack, and *print* the suggested replacement text for the owner to
  apply. Never edit a file the host owns — §2 rule 3.
- **`stale` vs `hand-edited` is the whole point of the header.** `stale` = the pack moved on,
  safe to re-add. `hand-edited` = the user changed the copy, re-adding destroys their work.
  Confusing them makes `kb pack add` a data-loss command. Test both states explicitly.
- **`.anchor/doctrine/` is not an entity kind.** No seventh kind. `loadStore` must not load
  it and `kb verify` must not check it, exactly as with `UP-` reports. Write the test that
  asserts `loadStore` ignores it — that is the test where the rule must speak.
- **An invariant without a checker is a wish.** SOLID is mostly not machine-checkable. Put
  dependency-inversion-adjacent rules where checkers already exist, and put SRP/OCP/LSP in
  `doctrine/` as prose, saying plainly that they are not enforced. Do not create an `INV-`
  you cannot check, and do not duplicate the five in `SHIPPED_INVARIANTS`.
- **`planPack` does no I/O and reads no clock.** Not `node:fs`, not `node:crypto`, not
  `new Date()`. ESLint enforces this via `anchoring.guards.mjs`; if you hit that rule, the
  answer is to inject the value, never to move the module out of the pure layer. A function
  that cannot read a file cannot leak one.

**Also required, and easy to forget:** §A.10. This repository's `README.md` ends with a
paragraph admitting that nothing checks the personal rules against the design, and asking a
human to remember. That is the exact failure this project exists to abolish, committed in its
own README. Once the content is in the pack, an anchor can reach it — delete that paragraph,
replace it with a pointer, and add the anchors so `kb why templates/packs/discipline/`
returns something.

**How to work.**

- One commit per coherent unit, conventional-commits format (`feat(pack): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote.
- Never edit `docs/origin/`, `anchoring.guards.mjs`, or `anchoring.depcruise.cjs` by hand —
  the last two are generated; run `kb guards` after updating the layer matrix in
  `anchoring.config.json`.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead. Loosening a threshold to pass is an automatic review
  failure.

**When you finish**, write the report described in `docs/PLAN-LAYER4.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, the new entity and anchor counts as
numbers, each §A.11 acceptance item with what it actually printed, and every defect you
found in the plan. This plan was written without executing it; the previous three plans in
this repository each contained three to five defects. Reporting one is a contribution.
