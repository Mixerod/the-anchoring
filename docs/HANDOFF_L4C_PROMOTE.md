# Handoff — Layer 4, Part C: Promotion

Copy everything below the line into the implementing agent.

---

**Do not start this until Part A (packs) is merged to `main`.** Part C writes into a pack; if
`templates/packs/` and `src/pack.ts` do not exist, stop and say so rather than building a
substitute.

You are working in **one** repository: `D:\MyGitRepos\the-anchoring`. You write nowhere else
on this machine.

**Your task:** implement `docs/PLAN-LAYER4.md` **Part C (§5) only.**

**Read first, completely, before writing any code:**

1. `docs/PLAN-LAYER4.md` §1, §2, §5, §6, §7. §5 is your specification.
2. `src/upstream.ts`, in full. Part C is the mirror image of the upstream loop and is built
   in the same shape: pure planner, thin apply, ids allocated from what the caller already
   read off disk. Pay particular attention to `planUpstream`'s fourth argument and *why* it
   exists — see the last section of `docs/RESUME-LAYER31.md`.
3. `src/verify-hazard.ts`, in full. The clock and the ceiling in that file are what make §5.3
   a real problem rather than a hypothetical one.
4. `src/pack.ts` as merged by Part A, and `.anchor/incident/INC-0001.md` and `INC-0002.md` —
   your two real inputs.

**Confirm the baseline before you start:** `npm install && npm run verify` passes, and
`npm run kb -- verify --strict` prints a clean line. Record the entity and anchor counts you
start from; you will state the delta at the end. If verify is red, stop and report.

**What Part C is.** The `HAZ` kind is defined in the schema as *"a failure mode that has
happened **elsewhere**, whose mechanism this repo could reproduce."* Nothing in the tool can
make one arrive from elsewhere — every hazard has to be typed by hand, in every repository,
forever. The upstream loop carries `INC → report → upstream repository`. Part C builds the
missing direction: `INC here → HAZ in a pack → seeded into the next project`. That is
literally the accumulation the owner built this tool for.

**The four things most likely to go wrong here:**

- **A promoted hazard must carry nothing local.** No `holds_for` anchors (they dangle on
  arrival and train the reader to ignore dangling anchors), no absolute path, no drive
  letter, no source excerpt, no diff, no file content, no repository name. Purity gives you
  most of this for free — the planner cannot read a file, so it cannot leak one. Keep it that
  way, and resist adding a "helpful" code excerpt. Write the test that asserts the absence.
- **§5.3 is the trap, and it is already specified — implement it, do not rediscover it.**
  `verify-hazard.ts` puts every `open` hazard on a 30-day clock that `--strict` turns into a
  failed build, and caps the total at 24. A pack that seeds twenty open hazards therefore
  breaks its adopter's build a month after installation, and the adopter switches off
  `--strict` — at which point nothing is enforced at all. The specified resolution:
  promoted hazards are written `resolution: not-applicable` with a `reason` saying they are
  untriaged, `kb pack add` prints the untriaged count, and it refuses (seeding none) rather
  than exceeding `hazard.ceiling`. If you conclude this resolution is wrong, **stop and
  report your reasoning.** Do not choose a different one silently, and under no circumstances
  raise `openDays` or `ceiling` to make the problem go away.
- **Promoting the same incident twice must not allocate a second id.** `planUpstream` got
  exactly this wrong once and reported its own report `missing` forever. Read how it was
  fixed, and test the second invocation.
- **Promotion is never automatic.** `kb promote` is invoked by a person who has decided the
  lesson generalises. Do not add a hook, a heuristic, or a `--all` that promotes on the
  tool's own judgment: that fills the pack with noise and walks the ceiling problem back in
  through the front door. A mechanism that can never say "no" reports noise until somebody
  switches it off.

**On `source:`** — a hazard without a source is a rumour, and `verify-hazard.ts` says so. The
origin must come from the owner, not from a local path. If the incident carries no upstream
evidence to derive it from, require it as a flag and fail with a clear message rather than
inventing a plausible value.

**How to work.**

- The planner is a **domain** module: pure, no `node:fs`, no `node:crypto`, no `new Date()`.
  Clocks and file contents arrive as arguments. Register any new module in the layer matrix
  in `anchoring.config.json` and run `kb guards` to regenerate the fragments. Never hand-edit
  `anchoring.guards.mjs` or `anchoring.depcruise.cjs`.
- One commit per coherent unit, conventional-commits format (`feat(promote): …`).
- Never run `npm publish`, `git push`, `gh repo create`, or add a git remote. Never edit
  `docs/origin/`.
- If a check fails, fix the code. Do not raise `maxFileLines` (400) or `maxFunctionLines`
  (50); split the module instead.

**When you finish**, write the report described in `docs/PLAN-LAYER4.md` §7: the real last
lines of `npm run verify` and `kb verify --strict`, the entity and anchor counts as numbers,
each §C.4 acceptance item with what it actually printed, and every defect you found in the
plan. Include your judgment on whether the §5.3 resolution held up in practice — that is the
part of this plan written with the least evidence, and your implementation is the first test
of it.
