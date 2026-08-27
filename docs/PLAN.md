# Porting plan — from `@dicebound/kb` to `the-anchoring`

**Audience:** an autonomous coding agent. Read this file end to end before touching code.
Everything that could reasonably be decided has already been decided here. Where this
document says MUST or MUST NOT, it is not a preference — a deviation fails review.

**Repository:** `D:\MyGitRepos\the-anchoring`
**Upstream it came from:** `D:\MyGitRepos\dicebound`, directory `tools/kb/` (read-only reference; never edit it)
**Pattern spec:** [`docs/THE_ANCHORING.md`](THE_ANCHORING.md) — the *why*. This file is the *what*.

---

## 0. What already exists (do not redo)

The repository is scaffolded and its baseline is green. Confirm before starting:

```bash
npm install
npm run typecheck   # clean
npm run test        # 12 files, 144 tests, all passing
```

| Path | State |
|---|---|
| `src/*.ts` (12 modules, 12 test files) | copied **verbatim** from `dicebound/tools/kb/src`. Unmodified. This is the baseline. |
| `docs/THE_ANCHORING.md` | the portable spec, copied verbatim |
| `docs/origin/` | read-only provenance: ADR-0013, ADR-0015, the original `.dicebound/README.md`, the original pre-commit hook and Stop-hook settings. **Reference only — never imported, never executed.** |
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.github/workflows/ci.yml`, `.gitignore` | standalone, npm-shaped, already working |

The baseline still contains every Dicebound-specific hardcode. Removing them is the job.

---

## 1. The goal, stated as an acceptance test

When this plan is complete, a person with an unrelated repository must be able to do this
and have it work, with no edit to any file inside `the-anchoring`:

```bash
cd ~/some-other-project
npx the-anchoring init          # writes anchoring.config.json + the .anchor/ tree
npx kb verify                   # exits 0, reports "0 entities, 0 anchors"
# ...they write one ADR with a file: anchor...
npx kb why src/thing.ts         # names that ADR
npx kb ctx W-1                  # after they create .anchor/work/W-1.md
npx kb done --check             # reports gaps, exit 0
```

Nothing in that sequence may contain the strings `dicebound`, `.dicebound`, or any path
that only exists in the Dicebound repository.

---

## 2. Naming decisions — already made, do not revisit

| Thing | Value | Note |
|---|---|---|
| npm package name | `the-anchoring` | |
| CLI binaries | `kb` (primary) and `anchoring` (alias) | both point at the same entry |
| Config file | `anchoring.config.json` | JSON, not YAML, not JS — keeps `js-yaml` the only runtime dependency and keeps the file machine-editable |
| Default KB directory | `.anchor/` | replaces `.dicebound/` |
| Default ADR directory | `docs/adr` | unchanged from upstream |
| Session note | `<kbRoot>/session/current` | derived from `kbRoot`, never hardcoded |
| License | MIT | already in `package.json`; `LICENSE` file added in T5 |

---

## 3. Non-negotiable rules for this port

1. **Behaviour parity.** Every string the CLI prints stays byte-identical to the baseline,
   except where it contained a hardcoded `.dicebound` path (which becomes the configured
   path). If a test asserting output text needs changing for any *other* reason, the change
   is wrong — fix the code instead.
2. **No module-level config singleton.** Configuration is loaded exactly once, in `cli.ts`,
   and threaded downward as a function parameter. No `let config` at module scope, no
   `process.env` read outside `cli.ts`, no lazy global initialiser. This is the same
   discipline the baseline already applies to git, the symbol probe, and the clock — and it
   is why the baseline is testable at all.
3. **Only paths, patterns and thresholds are configurable.** The *schema* is not: the six
   entity kinds, `LINK_FIELDS`, `SCALAR_FIELDS`, `EDGE_PHRASE`, `HAZARD_RESOLUTIONS` and
   the two anchor forms stay hardcoded in `model.ts`. A repository that wants a seventh
   entity kind is out of scope, on purpose — see `docs/THE_ANCHORING.md`, "Anti-rule".
4. **No new runtime dependency.** `js-yaml` remains the only entry under `dependencies`.
   Dev dependencies may be added only with a stated reason in the commit message.
5. **All I/O stays injected.** git, the codegraph probe, and the clock are already
   parameters with defaults. Any new I/O you add follows the same shape. No new
   `spawnSync`, `readFileSync` or `Date` call may appear in a pure function.
6. **Anchors are `file:` or `sym:` only. Line numbers are never an anchor form.**
7. **File size.** No source file over 400 lines. `verify.ts` is 298 today; if a task pushes
   it past 400, split it (`verify/hazard.ts`, `verify/refs.ts`) rather than letting it grow.
8. **Never** run `npm publish`, `git push`, `gh repo create`, or add a git remote. Packaging
   means *ready to publish*, not published. Publishing is the owner's decision.
9. **Never edit anything under `D:\MyGitRepos\dicebound`.** It is the reference, and it is
   a live project on branch `phase-0`.
10. **Never edit `docs/origin/`.** It is frozen provenance.

---

## 4. Every Dicebound coupling, enumerated

This is the complete list. If you find one not on it, add it to this table in the same
commit that fixes it.

| # | File · line | Coupling | Fixed in |
|---|---|---|---|
| C1 | `src/cli.ts:24` | `REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')` — assumes the source sits at `<repo>/tools/kb/src/` | T1 |
| C2 | `src/model.ts:20` | `ADR.dir = 'docs/adr'` hardcoded | T2 |
| C3 | `src/model.ts:25,30,35,40,45` | `INV/FLOW/WORK/INC/HAZ.dir` hardcoded to `.dicebound/...` | T2 |
| C4 | `src/model.ts:18` | `idPattern` and `statuses` per kind not overridable | T2 |
| C5 | `src/model.ts:115,122` | `HAZARD_OPEN_DAYS = 30`, `HAZARD_CEILING = 24` as module constants | T2 |
| C6 | `src/session.ts:15` | `SESSION_FILE = '.dicebound/session/current'` | T3 |
| C7 | `src/done.ts:39` | `NEEDS_A_REASON = ['packages/', 'apps/', 'scripts/']` — Dicebound's layout | T3 |
| C8 | `src/done.ts:150` | user-facing fix text `create .dicebound/work/${workId}.md` | T3 |
| C9 | `src/render.ts:116` | user-facing text `Create .dicebound/work/${report.query}.md` | T3 |
| C10 | `src/model.ts:8` | doc comment cites `docs/adr/0013-...` and `0015-...` (paths that do not exist here) | T3 |
| C11 | `src/cli.ts:9-10` | doc comment cites `.agent/rules/15-retrieval.md` | T3 |
| C12 | `src/anchors.ts:6` | doc comment example `file:packages/core/src/tempo/costs.ts` | T3 (cosmetic, but it teaches the reader a wrong layout) |
| C13 | `src/render.ts:146` | prints `Then: codegraph explore "<your question>"` unconditionally | T3 |
| C14 | `src/cli.ts:1` | shebang `#!/usr/bin/env -S npx tsx` — cannot work from `dist/` | T5 |
| C15 | — | no bootstrap: the three gates and the scripts are wired by hand in the host repo | T4 |
| C16 | test fixtures across `src/*.test.ts` | build `.dicebound/...` paths | T2/T3, as each is touched |

---

## 5. Tasks

Tasks are **strictly sequential**. Each ends with `npm run verify` green and exactly one
commit, message given below. Do not batch two tasks into one commit.

---

### T1 — Find the repository root honestly

**Problem:** C1. The CLI locates the repo by counting `../` from its own source file, so
installing the package anywhere else points it at the wrong directory.

**Create `src/root.ts`:**

```ts
export function findRepoRoot(startDir: string): string | undefined
```

Behaviour, in this exact order:

1. Walk from `startDir` upward to the filesystem root.
2. Return the first directory containing `anchoring.config.json`.
3. If none was found, walk again and return the first directory containing `.git`
   (file **or** directory — `.git` is a file in a worktree, and worktrees must work).
4. Otherwise return `undefined`.

Rule 2 before rule 3 is deliberate: a monorepo may hold several anchored sub-projects
inside one git repository, and the nearest config wins.

**Change `src/cli.ts`:** delete `REPO_ROOT` and the `fileURLToPath`/`dirname` imports used
only by it. `run()` keeps its signature `run(argv, out, err, root?, changedFiles?)`. When
`root` is not supplied, resolve `findRepoRoot(process.cwd())`. If that returns `undefined`,
write to `err`:

```
kb: not inside a repository. Run `kb init` at the root of your project first.
```

and return `2`. Do not throw.

**Tests — new file `src/root.test.ts`, at least 6:**
- finds a directory containing `anchoring.config.json`
- finds it from a nested subdirectory
- falls back to a directory containing `.git` as a directory
- falls back to a directory containing `.git` as a *file* (worktree)
- prefers a nearer `anchoring.config.json` over a further `.git`
- returns `undefined` in a temp directory with neither

**Acceptance:** `grep -rn "\.\./\.\./\.\." src/` returns nothing. 144 + ≥6 tests green.

**Commit:** `feat(root): locate the repository by config or .git, not by source path`

---

### T2 — The configuration layer

**Problem:** C2–C5. Paths, id shapes, statuses and hazard thresholds are compile-time
constants.

#### 2a. The file format

`anchoring.config.json`, at the repository root. Every field optional; an empty `{}` must
produce exactly the defaults.

```jsonc
{
  "kbRoot": ".anchor",
  "kinds": {
    "ADR":  { "dir": "docs/adr" },
    "INV":  { "dir": ".anchor/invariant", "idPattern": "^INV-[A-Z0-9-]+$",
              "statuses": ["active", "retired"] },
    "FLOW": { "dir": ".anchor/flow" },
    "WORK": { "dir": ".anchor/work" },
    "INC":  { "dir": ".anchor/incident" },
    "HAZ":  { "dir": ".anchor/hazard" }
  },
  "governedPaths": ["src/", "packages/", "apps/", "lib/", "scripts/"],
  "hazard": { "openDays": 30, "ceiling": 24 },
  "symbolIndex": "codegraph"
}
```

**Defaults, when a field is absent:**

| Field | Default |
|---|---|
| `kbRoot` | `.anchor` |
| `kinds.ADR.dir` | `docs/adr` |
| `kinds.<other>.dir` | `<kbRoot>/<folder>` where the folders are `invariant`, `flow`, `work`, `incident`, `hazard` |
| `kinds.*.idPattern` | exactly the baseline patterns in `model.ts` |
| `kinds.*.statuses` | exactly the baseline status lists in `model.ts` |
| `governedPaths` | `["src/", "packages/", "apps/", "lib/", "scripts/"]` |
| `hazard.openDays` | `30` |
| `hazard.ceiling` | `24` |
| `symbolIndex` | `"codegraph"` |

`symbolIndex: "none"` makes `createResolver` skip the probe entirely and report every
`sym:` anchor as `unverifiable` with detail `symbol index disabled in anchoring.config.json`.
It must not spawn a process. This exists so a repo with no codegraph gets no warning noise.

#### 2b. The resolved type

**Create `src/config.ts`:**

```ts
export interface KindSpec {
  readonly dir: string                      // repo-relative, forward slashes
  readonly idPattern: RegExp
  readonly statuses: readonly string[]
}

export interface AnchoringConfig {
  readonly root: string                     // absolute repository root
  readonly kbRoot: string                   // repo-relative
  readonly kinds: Readonly<Record<EntityKind, KindSpec>>
  readonly governedPaths: readonly string[]
  readonly hazard: { readonly openDays: number; readonly ceiling: number }
  readonly symbolIndex: 'codegraph' | 'none'
  readonly sessionFile: string              // derived: `${kbRoot}/session/current`
}

export function defaultConfig(root: string): AnchoringConfig
export function loadConfig(root: string): { ok: true; config: AnchoringConfig }
                                        | { ok: false; problems: readonly string[] }
export function parseConfig(root: string, raw: unknown):
  { ok: true; config: AnchoringConfig } | { ok: false; problems: readonly string[] }
```

`loadConfig` reads `<root>/anchoring.config.json` if present and delegates to `parseConfig`;
with no file it returns `defaultConfig(root)`. `parseConfig` is pure — no filesystem — so it
is testable directly.

**Validation, each producing one entry in `problems`:**
- the file is not valid JSON → `anchoring.config.json: invalid JSON: <message>`
- top level is not an object
- an unknown top-level key → name it and list the accepted keys (typos must be loud, not silent)
- an unknown key under `kinds` → name it and list the six kinds
- `dir` is absolute, contains `..`, or contains a backslash → reject; dirs are repo-relative POSIX paths
- `idPattern` is not a string, does not start `^`, does not end `$`, or fails `new RegExp()`
- `statuses` is not a non-empty array of non-empty strings
- `governedPaths` is not an array of non-empty strings; **normalise** each to end with `/`
- `hazard.openDays` / `hazard.ceiling` are not positive integers
- `symbolIndex` is not `"codegraph"` or `"none"`
- two kinds resolve to the same `dir` → reject (documents would load twice)

`loadConfig` returning `ok: false` makes the CLI print every problem, one per line, prefixed
`config error:`, and exit `2`. It must never fall back to defaults after a bad config — a
silently-ignored config is exactly the class of failure this whole project exists to prevent.

#### 2c. Threading it through

Change these signatures. `root: string` is **removed** wherever `config` now carries it.

| Before | After |
|---|---|
| `loadStore(root)` | `loadStore(config)` |
| `verify(root, now?)` | `verify(config, now?)` |
| `why(root, query)` | `why(config, query)` |
| `ctx(root, query)` | `ctx(config, query)` |
| `done(root, workId, changedFiles?)` | `done(config, workId, changedFiles?)` |
| `unclaimedWork(changedFiles, root)` | `unclaimedWork(config, changedFiles)` |
| `createResolver(root, probe?)` | `createResolver(config, probe?)` |
| `rememberWork(root, workId)` | `rememberWork(config, workId)` |
| `recallWork(root)` | `recallWork(config)` |
| `kindOf(id)` | `kindOf(config, id)` |
| `hasCodegraphIndex(root)` | `hasCodegraphIndex(config)` |

`gitChangedFiles` keeps taking a plain `root: string` — it is the injected I/O boundary and
must stay ignorant of the schema. `cli.ts` passes `config.root` to it.

In `model.ts`: delete `KIND_SPEC`, `HAZARD_OPEN_DAYS` and `HAZARD_CEILING`. Move the literal
defaults into `config.ts` as `DEFAULT_KINDS` / `DEFAULT_HAZARD`. Keep `ENTITY_KINDS`,
`LINK_FIELDS`, `SCALAR_FIELDS`, `EDGE_PHRASE`, `HAZARD_RESOLUTIONS` exactly where they are.

`cli.ts` calls `loadConfig(root)` once, at the top of `run()`, and passes the result down.

**Tests — new file `src/config.test.ts`, at least 12:**
- `{}` yields defaults identical to `defaultConfig`
- absent file yields defaults
- `kbRoot` override moves all five non-ADR dirs
- a per-kind `dir` override wins over the `kbRoot`-derived default
- `idPattern` override is honoured by `kindOf`
- `statuses` override is honoured by the loader
- each validation rule above rejects, with the problem text asserted (grouping related rules
  in one test is fine, but every rule must be covered)
- a bad config makes `run(['verify'], …)` exit `2` and print `config error:`
- `symbolIndex: "none"` reports `sym:` anchors as `unverifiable` and never calls the probe
  (assert with a probe that throws if called)

**Existing tests:** update fixtures from `.dicebound/...` to `.anchor/...` and thread config.
Prefer a shared helper in each test file over repeating `loadConfig`. Assertion text may not
change for any other reason.

**Acceptance:** `grep -rn "dicebound" src/` returns nothing. All prior tests still green.

**Commit:** `feat(config): make paths, id patterns and hazard thresholds configurable`

---

### T3 — Remove the remaining hardcodes and the stale prose

**Problem:** C6–C13.

- **C6** `session.ts`: `SESSION_FILE` becomes `config.sessionFile`.
- **C7** `done.ts`: `NEEDS_A_REASON` becomes `config.governedPaths`. Keep the comment
  explaining why it is an allowlist and not a denylist — that reasoning is load-bearing and
  cost an incident to learn.
- **C8/C9**: the two "create the work item" strings interpolate `config.kinds.WORK.dir`.
- **C10/C11/C12**: rewrite the doc comments. They must cite files that exist **in this
  repository** (`docs/THE_ANCHORING.md`, and after T6 the `.anchor/` documents), never
  Dicebound paths. The example anchor in `anchors.ts` becomes `file:src/verify.ts`.
- **C13** `render.ts`: the trailing `codegraph explore` line prints only when
  `config.symbolIndex === 'codegraph'` **and** a `.codegraph` directory exists. Otherwise
  print `Read only what applies.` alone. A tool suggesting a command the user does not have
  installed teaches them to ignore its output.

**Acceptance:** `grep -rniE "dicebound|packages/core|tempoCost|\.agent/rules" src/` returns
nothing. `npm run test` green.

**Commit:** `refactor(paths): derive every path and hint from configuration`

---

### T4 — `kb init`

**Problem:** C15. Today, adopting the pattern means hand-wiring four things in the host repo.

**Create `src/init.ts`:**

```ts
export interface InitPlan {
  readonly root: string
  readonly files: readonly { readonly path: string; readonly body: string }[]
  readonly dirs: readonly string[]
  readonly gitignoreLine?: string
  readonly notes: readonly string[]
}

export function planInit(root: string, options: InitOptions, probe: FsProbe): InitPlan
export function applyInit(plan: InitPlan, io: InitIo): readonly string[]   // paths written
```

Splitting *plan* from *apply* is required, not stylistic: it is what makes `init` testable
without writing to a real tree, and it is what lets `--dry-run` be three lines instead of a
second code path. `FsProbe` (`(relPath: string) => boolean`) and `InitIo`
(`mkdir`/`writeFile`/`readFile`) are the injected I/O — same rule as everywhere else.

**CLI:** `kb init [--kb-root <dir>] [--dry-run] [--force]`

Behaviour:

1. Root = `findRepoRoot(cwd)` ignoring `anchoring.config.json` (use the `.git` rule only);
   if there is no `.git`, use `cwd` and add a note that this is not a git repository.
2. If `anchoring.config.json` already exists and `--force` was not passed: print
   `kb init: anchoring.config.json already exists (use --force to overwrite)` and exit `1`.
   Write nothing.
3. **Detect the ADR directory** — first that exists: `docs/adr`, `docs/adrs`, `doc/adr`,
   `docs/decisions`, `adr`. If none exists, use `docs/adr`.
4. **Detect `governedPaths`** — every top-level directory that exists among `src`,
   `packages`, `apps`, `lib`, `services`, `cmd`, `internal`, `scripts`, suffixed with `/`.
   If none exists, use `["src/"]` and add a note saying so.
5. **Detect `symbolIndex`** — `"codegraph"` if `.codegraph/` exists, else `"none"`.
6. Write `anchoring.config.json` with every detected value written out **explicitly**, not
   omitted-as-default. A generated config is documentation; the reader should see what it is
   getting without consulting a defaults table.
7. Create `<kbRoot>/{invariant,flow,work,incident,hazard,session}/`, each with `.gitkeep`,
   and the ADR directory if absent.
8. Write `<kbRoot>/README.md` and one `0000-template.md` per kind, from `templates/`
   (see below). `store.ts` already skips files starting `0000-template`, so templates never
   load as entities — do not change that filter.
9. Append `<kbRoot>/session/` to `.gitignore` (create the file if absent; skip if the line is
   already present).
10. Print the **notes**: the three gates, as copy-pasteable snippets — the `Stop` hook JSON
    for `.claude/settings.json`, the `pre-commit` line, and the CI step. See
    `docs/origin/dicebound-*` for the originals to adapt.

**MUST NOT:** modify `package.json`, install a git hook, run `git config`, create `.claude/`,
touch the network, or write any path not listed in `InitPlan.files`/`dirs`. `init` prints
instructions for the gates; it never installs them. A tool that silently edits a repo's hooks
is a tool people uninstall.

**Create `templates/`** at the package root (not under `src/`), containing:
`README.md`, `adr.md`, `invariant.md`, `flow.md`, `work.md`, `incident.md`, `hazard.md`.
Each entity template is a valid document of its kind — correct frontmatter, every link field
present and empty, and a short body explaining what belongs in it. Adapt from
`docs/origin/dicebound-kb-README.md` and the real Dicebound documents, with every
project-specific reference removed.

Resolve `templates/` from `import.meta.url`. This is the **one** permitted use of
`import.meta.url` in the codebase: it locates a package asset, which is genuinely relative to
the module, unlike a repository root, which is not.

**Tests — new file `src/init.test.ts`, at least 10:**
- a bare temp directory produces a config with `governedPaths: ["src/"]` and the "no source
  directory detected" note
- `src/` present → `["src/"]`; `packages/` + `apps/` present → both, sorted, slash-suffixed
- `docs/adrs` existing is detected in preference to the default `docs/adr`
- `.codegraph/` present → `symbolIndex: "codegraph"`; absent → `"none"`
- refuses when `anchoring.config.json` exists; `--force` overwrites
- `--dry-run` writes nothing and lists every path it would write
- `.gitignore` gains the session line exactly once, even when run twice
- the six kind directories and their `.gitkeep` files are created
- every written template parses: after `init`, `verify` on that tree returns zero findings
  and `entityCount === 0`
- `--kb-root docs/kb` moves the whole tree and the config agrees

**Acceptance:** in a fresh temp git repo, `kb init && kb verify` exits 0 twice in a row.

**Commit:** `feat(init): bootstrap the intent graph into any repository`

---

### T5 — Package it

**Problem:** C14, plus the package is not installable.

1. `src/cli.ts` shebang becomes `#!/usr/bin/env node`.
2. `tsconfig.json`: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`. The imports
   already carry `.js` extensions, so no import statement should need editing — if one does,
   that is a real bug the bundler resolver was hiding.
3. Add `"build": "tsc"` and `"prepublishOnly": "npm run verify && npm run build"`.
4. `package.json` gains:
   ```jsonc
   "bin":   { "kb": "./dist/cli.js", "anchoring": "./dist/cli.js" },
   "main":  "./dist/index.js",
   "types": "./dist/index.d.ts",
   "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
   "files": ["dist", "templates", "README.md", "LICENSE"],
   "keywords": ["agents", "knowledge-graph", "adr", "documentation", "codegraph"]
   ```
5. Create `src/index.ts` re-exporting the public API: `loadConfig`, `defaultConfig`,
   `findRepoRoot`, `verify`, `why`, `ctx`, `done`, `run`, and the result types. Nothing else
   is public.
6. Add `LICENSE` (MIT, copyright holder `Mixerod`, year 2026).
7. Rewrite the root `README.md`: what it is in three sentences, install, the four commands
   with real output, the config table, a link to `docs/THE_ANCHORING.md` for the reasoning.
   The `docs/THE_ANCHORING.md` file itself is **not** replaced or trimmed.
8. Extend CI: add `npm run build`, then a smoke job that runs the built binary against a
   temp directory — `node dist/cli.js init` then `node dist/cli.js verify` — and asserts exit
   0. A packaging bug that only appears after `tsc` must fail in CI, not on a user's machine.

**MUST NOT:** publish. Do not run `npm publish`, do not run `npm version`, do not add a
`publishConfig` with a registry token, do not create a git remote.

**Acceptance:** `npm run build && node dist/cli.js --help` prints usage. `npm pack --dry-run`
lists `dist/`, `templates/`, `README.md`, `LICENSE` and nothing else.

**Commit:** `build: ship a real npm package with a compiled binary`

---

### T6 — Dogfood: apply The Anchoring to this repository

The strongest possible proof that the port worked is the tool anchoring itself. Do this last,
using only the shipped commands — no hand-created directories.

```bash
node dist/cli.js init
```

Then author, by hand, with correct frontmatter and resolving anchors:

| Document | Content |
|---|---|
| `docs/adr/0001-config-over-constants.md` | why paths/patterns/thresholds became configuration while the schema did not. `governs: [file:src/config.ts, file:src/root.ts]`, `constrains: [INV-CONFIG-THREADED]` |
| `docs/adr/0002-json-config-single-dependency.md` | why the config is JSON and `js-yaml` stays the only runtime dependency. `governs: [file:src/config.ts]` |
| `docs/adr/0003-init-plans-before-it-writes.md` | why `init` splits plan from apply. `governs: [file:src/init.ts]` |
| `.anchor/invariant/INV-CONFIG-THREADED.md` | "configuration is a parameter, never a module-level singleton". `enforced_by: [file:eslint.config.js]` — **and you must write that lint rule**: `no-restricted-syntax` forbidding a module-scope mutable binding named `config` in `src/**`, plus a test that the rule fires. An invariant without a checker is a wish (rule 3 of the spec). |
| `.anchor/invariant/INV-INJECTED-IO.md` | "git, the symbol probe, the clock and the filesystem reach the core as arguments". `enforced_by: [file:eslint.config.js]` — a `no-restricted-imports` rule banning `node:child_process` and `node:fs` from every `src/*.ts` except `git.ts`, `anchors.ts`, `frontmatter.ts`, `store.ts`, `session.ts`, `config.ts`, `init.ts`, `root.ts`. |
| `.anchor/flow/FLOW-0001.md` | "adopting The Anchoring in a new repository" — the acceptance test in §1 of this file, written as a flow. `served_by: [file:src/init.ts, file:templates]` |
| `.anchor/work/W-1.md` … `W-6.md` | one per task T1–T6, `status: done`, with real `implements` and `touches` |

Then wire this repository's own three gates, exactly as `kb init` prints them: the `Stop`
hook in `.claude/settings.json`, a `.githooks/pre-commit` running `npm run kb -- verify`, and
a CI step running `npm run kb -- verify -- --strict`.

**Acceptance:** `npm run kb -- verify -- --strict` exits 0. `npm run kb -- why src/config.ts`
names ADR-0001 and ADR-0002. `npm run kb -- ctx W-2` names ADR-0001 and INV-CONFIG-THREADED.

**Commit:** `docs: anchor this repository to itself`

---

## 6. Definition of done

Every line must be true:

- [ ] `npm run verify` green; `npm run build` green
- [ ] `grep -rniE "dicebound|tempoCost|packages/core" src/ templates/ README.md` → no matches
- [ ] `grep -rn "import.meta.url" src/` → only `src/init.ts` (template resolution) and the
      `invokedAs` guard at the bottom of `cli.ts`
- [ ] test count ≥ 180, line coverage ≥ 95%
- [ ] `npm run kb -- verify -- --strict` exits 0 against this repository's own `.anchor/`
- [ ] a fresh temp repo can be initialised and verified with the built binary
- [ ] `dependencies` contains exactly one entry: `js-yaml`
- [ ] no file in `src/` exceeds 400 lines
- [ ] nothing was published, pushed, or given a remote
- [ ] `D:\MyGitRepos\dicebound` is untouched — `git -C D:/MyGitRepos/dicebound status` is clean

## 7. Explicitly out of scope

Do not build these, even if they seem natural. Each was considered and deferred:

- `kb search`, SQLite/FTS5, embeddings, any vector store — see `docs/THE_ANCHORING.md`,
  "Deferred, with a trigger rather than a feeling". The trigger is a measurement, and the
  measurement does not exist yet.
- A seventh entity kind, or user-defined kinds.
- Anchors other than `file:` and `sym:`.
- A cache or persistent index of the corpus. Re-reading is the feature.
- An MCP server, a VS Code extension, a web UI.
- Migrating Dicebound onto the packaged version. That is a separate job, after this one has
  survived real use.
