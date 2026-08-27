# Layer 3.1 — what is done, what is not, and the one question that blocks the rest

Written 2026-08-28 at the end of the session that executed `docs/PLAN-LAYER31.md` T13–T21.

**Status: Part A and Part B are complete and committed. Part C is blocked at T18 on a
defect in the plan, not in either codebase. Part D was not reached.**

`D:\MyGitRepos\dicebound` was returned to its exact starting state — clean tree at
`8af6898`, `pnpm kb verify` → `clean (107 entities, 369 anchors)`. Nothing is left
half-applied there.

---

## The blocking question

`docs/PLAN-LAYER31.md` T18 says two things that cannot both be true:

1. *"Delete `tools/kb/` entirely."*
2. *"`pnpm kb verify --strict` must print `kb verify: clean (107 entities, 369 anchors)`.
   Any deviation in either number is a regression in the port, not a new baseline."*

**Twenty anchors point into `tools/kb/`.** Deleting the directory dangles every one of
them, and the plan never says what to do about it:

| Document | Field | Anchors into `tools/kb/` |
|---|---|---|
| `docs/adr/0013-knowledge-base-and-retrieval.md` | `governs`, `verified_by` | 3 |
| `docs/adr/0015-hazards-external-failure-modes.md` | `governs`, `verified_by` | 2 |
| `.dicebound/work/W-58.md` | `touches` | 5 |
| `.dicebound/work/W-59.md` | `touches` | 4 |
| `.dicebound/work/W-60.md` | `touches` | 1 |
| `.dicebound/work/W-61.md` | `touches` | 4 |
| `.dicebound/incident/INC-0001.md` | `touches` | 1 |

Two answers are consistent with the pattern's own doctrine, and they give **different**
values for the number the plan states as a hard criterion:

**Option A — remove the anchors, final count 349.** The code they named left this
repository. An anchor's job is to fail loudly when the code moves; it did, and the honest
resolution is that the claim no longer anchors anything *here*. Keep the prose record in
each document body and add a line saying the code now lives in `the-anchoring`. ADR-0013
and ADR-0015 keep their surviving `.dicebound` anchors, so neither trips
`governs_nothing`. **This is my recommendation:** it is what "update the anchor in the same
commit" means when the code leaves the repository, and 369 was a number computed before
the deletion rather than a property anybody chose.

**Option B — re-point them at `anchoring.config.json`, final count 369.** Defensible for
the two ADRs, whose decisions this repository now declares in that file. Not defensible for
the eleven `touches:` anchors on W-58…W-61 and INC-0001: pointing five distinct source
files at one config file is padding to hit a number, which is the exact failure the
discipline rules forbid.

A third possibility worth one minute of the owner's time: **Option C — leave `tools/kb/`
in place** for one more phase and install the package alongside it, so the migration and
the anchor question are separated. The plan rejects this implicitly but never argues it.

**Nothing else in Part C is ambiguous.** Answer this and T18–T21 can be executed straight
through.

## A second thing the plan did not anticipate

Dicebound's own `.git/hooks/pre-commit` runs `pnpm check:kb`, so **no commit can land in
that repository while `kb verify` is red.** T18's commit is therefore not independently
committable: the 70 `owner:` failures that T19 exists to fix are already failing at T18.
T18 and T19 must land as one commit, or T19's rename must come first. The plan's
one-commit-per-task rule does not survive contact with the repository's own gate — which
is the gate working, not a problem to route around.

---

## Done and committed in `the-anchoring`

| Commit | Task |
|---|---|
| `594d431` | `fix: seven defects found auditing the Layer 3 result` (T13) |
| `baf4a75` | `docs(spec): add the upstream loop to the pattern` (T14) |
| `d262b01` | `feat(upstream): record and validate upstream attribution on incidents` (T15) |
| `c629007` | `feat(upstream): project attributable incidents into reviewable reports` (T16) |
| `9fb689e` | `feat(upstream): open the work item in the upstream repository` (T17) |
| `170a9f8` | `fix(cli): run when installed as a package, not only from the checkout` (unplanned) |
| `8c3aa3f` | `feat(model): add executed_by for the agent that did the work` (T19, tool half) |

364 tests, `npm run verify` green, `kb verify --strict` → `clean (24 entities, 193 anchors)`.

### `170a9f8` is the first real finding from the first real adopter

Not in the plan, and worth reading before anything else resumes. `the-anchoring` runs
itself as `tsx src/cli.ts`, where `process.argv[1]` and `import.meta.url` are the same
file. Installed as a package they are not: a package manager puts a **symlink** at
`node_modules/<pkg>`, and Node resolves an ESM specifier to its real path. The entry guard
compared them literally, so the whole CLI did nothing and **exited 0**.

`pnpm kb verify --strict` against a 107-entity corpus printed nothing and returned success.
A gate that exits 0 having checked nothing is worse than one that fails, because CI goes
green. Fixed by comparing real paths (`isDirectlyInvoked` in `src/cli.ts`), with a test for
the symlink case specifically.

This is exactly what Part B was built to capture, and it is the first entry Part D should
file — `silent-gate`, `upstream_gate: verify`.

---

## Resume checklist

1. **Answer the anchor question above.** Nothing else blocks.
2. T18 + T19 as one commit in dicebound (see the gate note above): install
   `link:../the-anchoring`, delete `tools/kb/`, drop its `tsconfig.json` project reference
   (the plan omits this — `tsc -b` fails without it), write `anchoring.config.json`, rename
   `owner:` → `executed_by:` on all 70 work items, set `owner: @Mixerod` on ADRs only, drop
   `linear_url:` from the 57 work items that carry it, keep `linear:`, and note the retired
   tracker in `.dicebound/README.md`.
3. T20 — architecture block and guards composition. The three collisions are as the plan
   describes; `scripts/check-file-size.mjs` has the documented escape hatch.
4. T21 — file the incidents. At least two are already known: the `owner:` collision
   (`schema-gap`) and the silent CLI above (`silent-gate`).

## Corrections to `docs/PLAN-LAYER31.md`

- **T13(d)** attributes `codegraphProbe` to `anchors.ts` lines 56–91. `codegraphProbe`
  lives in `resolver.ts`; `anchors.ts` 56–91 was an untested duplicate of `checkAnchors`.
  Both are now covered.
- **T16** specifies `checkUpstream(plan, read)` in `upstream.ts` while **T15** specifies
  `checkUpstream(entity, config, now)` in `verify.ts`. Two different functions, one name.
  Both keep the specified name in their own module; `index.ts` exports the T16 one as
  `checkUpstreamReports`.
- **T16**'s `planUpstream(config, store, pkg)` cannot allocate stable ids from three
  arguments. It takes a fourth, optional: the `{ id, about }` pairs already on disk, read by
  `cli-upstream.ts`. Without it a second `kb upstream --check` allocates a fresh id and
  reports the existing report `missing` forever.
- **T18** does not mention `tsconfig.json`'s `./tools/kb` project reference. `pnpm
  typecheck` fails until it is removed.
