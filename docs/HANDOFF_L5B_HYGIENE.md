# Handoff — Layer 5, Part B: colour, token accounting, body budget

Copy everything below the line into the implementing agent.

---

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You write nowhere else
on this machine.

**Your task:** implement `docs/PLAN-LAYER5.md` **Part B (§4) only.** Parts A and C belong to
other agents; do not start them, do not stub them.

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER5.md` §1, §2, §4, §6, §7.
2. `src/render.ts` in full — particularly `Palette` and `PLAIN`. The fix in §B.1 is half
   built already; you are wiring up an abstraction that exists, not creating one.
3. `src/cli.ts` — where the palette choice belongs. `render.ts` keeps receiving a palette as
   an argument and must learn nothing about `process`.
4. `src/verify.ts` and `src/finding.ts` — how findings carry severity, and how `--strict`
   maps severity to an exit code. §B.3 depends on getting that mapping right.

**Confirm the baseline before you start:**

```
npm install && npm run verify
npm run kb -- verify --strict          # expect: kb verify: clean (31 entities, 264 anchors)
```

If either differs, stop and report. Do not start fixing.

**What Part B is.** Three small things that each cost tokens on every call, forever. One is a
confirmed defect with evidence; two are measurements the tool has never taken of itself.

**The confirmed defect.** `PLAIN` is referenced only from tests — production always emits
ANSI, including into a pipe:

```
$ npm run kb -- verify --strict | tail -2
\x1b[32mkb verify: clean\x1b[0m \x1b[2m(31 entities, 264 anchors)\x1b[0m
```

Invisible to a human, pure waste to an agent capturing the output. Select `PLAIN` when
`process.stdout.isTTY` is falsy, or `NO_COLOR` is set to any value, or `--no-color` is
passed; add `--color` to force it back on.

**The three things most likely to go wrong here:**

- **The body budget must never fail the build — under any flag, including `--strict`.** A
  build that goes red because a document is verbose is a build people learn to bypass, and
  the checks that matter get bypassed with it. Warning only. Write the test that asserts
  `kb verify --strict` **exits 0** with an over-budget body present, and put the reasoning in
  the code comment so the next person does not "tighten" it.
- **Do not fake a token count.** This tool calls no network and no tokenizer. Report **bytes**
  as the measured number; a token figure may accompany it only if it is explicitly labelled
  an estimate and states its divisor. Emitting a confident token count derived from nothing
  is exactly the over-claiming the discipline rules exist to prevent.
- **`NO_COLOR` follows the published convention: set to *any* value, including empty.** Do
  not test it for truthiness — `NO_COLOR=` and `NO_COLOR=0` both mean "no colour". Getting
  this wrong is the kind of near-miss that looks correct in every manual test.

**How to work.**

- The palette decision is a CLI-boundary concern. Keep `render.ts` pure and parameterised.
- One commit per coherent unit, conventional-commits format (`fix(cli): …`, `feat(verify): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote. Never edit
  `docs/origin/`, `anchoring.guards.mjs`, or `anchoring.depcruise.cjs` by hand.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead.

**When you finish**, write the report described in `docs/PLAN-LAYER5.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, every §B.4 acceptance item with what it
actually printed, **the current corpus byte breakdown by tier and kind as numbers**, and
every defect you found in the plan. This plan was written without executing it; reporting a
defect is a contribution, not a complaint.
