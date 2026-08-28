# Handoff — Layer 4, Part B: `kb ask`

Copy everything below the line into the implementing agent.

---

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You write nowhere else
on this machine.

**Your task:** implement `docs/PLAN-LAYER4.md` **Part B (§4) only.** Parts A and C belong to
other agents. Part B depends on neither, so do not wait for them — but if `.anchor/doctrine/`
does not exist yet (Part A creates it), simply omit that section of the output rather than
stubbing the directory.

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER4.md` §1, §2, §4, §6, §7. §4 is your specification.
2. `docs/THE_ANCHORING.md` — in particular **"What it is not"**. The argument against
   embeddings and persistent indexes is load-bearing and you are not permitted to relitigate
   it in code.
3. `src/ctx.ts` and `src/why.ts`, in full. `kb ask` is a sibling of these two and must read
   like one.
4. `src/store.ts` — specifically the comments stating that it **never loads a document
   body**. That constraint shapes your entire design.
5. `src/render.ts` — output formatting, so `kb ask` reads like the other commands.

**Confirm the baseline before you start:**

```
npm install && npm run verify          # expect 364 tests passing, typecheck/lint/depcruise clean
npm run kb -- verify --strict          # expect: kb verify: clean (26 entities, 196 anchors)
```

If either differs, stop and report. Do not start fixing.

**What Part B is.** Every retrieval path in this tool starts from an entity that already
exists: `kb ctx` needs a `W-` id, `kb why` needs a path or symbol. There is no way to ask
*"I am about to add a payment webhook — what in this repository bears on that?"* before any
work item exists. `AGENTS.md` §1 currently tells an agent to go find or open a work item
first. Part B is the missing front door, and it is the moment the owner cares about most:
install the tool, ask it a question, get the accumulated judgment back.

**The four things most likely to go wrong here:**

- **You will want to read document bodies, and you must not.** `store.ts` never loads one,
  says so twice in its own comments, and `kb ask` must not become the reason it starts. Match
  on frontmatter: `id`, `title`, and a new `tags:` field. If you believe body matching is
  necessary, stop and report — do not add it quietly.
- **You will want to build an index or a cache, and you must not.** No embeddings, no vector
  store, no persistent index, no memo table. Re-read the corpus on every call; at this scale
  it is single-digit milliseconds, and no cache means no staleness. `THE_ANCHORING.md`
  argues this at length.
- **Invariants are not ranked, they are always returned in full.** An invariant that applies
  only when a keyword happens to match is not an invariant. Same for `active` hazards whose
  `resolution` is `open` — an unread hazard is worse than none, which is why the clock on
  them exists. Only ADR, FLOW, WORK and INC get ranked and limited.
- **The negative path is the feature, not an edge case.** A query matching nothing must say
  so loudly and specifically: name the query, the corpus size searched, and the fact that the
  invariants above still apply. A retrieval tool that returns a plausible-looking list for
  every input is unauditable, and an unauditable filter is trusted right up until it is
  ignored. Write the test where it must *speak* — `kb ask "quantum teleportation scheduler"`
  returns zero ranked matches and says so — not only the test where it must pass.

**Determinism is an acceptance criterion, not a nicety.** Ties break by id ascending. Output
must be byte-identical across two consecutive runs against an unchanged corpus, or it cannot
be diffed or tested. Assert it.

**On `tags:`** — you are adding one scalar field to all six kinds in `src/model.ts`. That
file's own comment promises adding a field is a one-line change; hold it to that promise, and
if it is not, that is a finding worth reporting. Validate the value shape (a list of
lowercase slugs) in `verify`, with a clear message naming the offending value.

**How to work.**

- `src/ask.ts` is a **domain** module: pure, no I/O, no clock except an injected one. Add it
  to the `domain` layer in `anchoring.config.json` and run `kb guards` to regenerate the
  fragments. Never hand-edit `anchoring.guards.mjs` or `anchoring.depcruise.cjs`.
- One commit per coherent unit, conventional-commits format (`feat(ask): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote. Never edit
  `docs/origin/`.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead.
- Update `AGENTS.md` §2 so `kb ask` is the documented cold-start move when no work item
  exists. A retrieval command nobody is told to run is a command nobody runs.

**When you finish**, write the report described in `docs/PLAN-LAYER4.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, the new entity and anchor counts as
numbers, each §B.4 acceptance item with what it actually printed, and every defect you found
in the plan. This plan was written without executing it; reporting a defect is a
contribution, not a complaint.
