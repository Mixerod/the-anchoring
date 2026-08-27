# Layer 3 — the guards: shipping enforcement, not just the slot for it

**Audience:** an autonomous coding agent. Read this file end to end before touching code.
It has the same standing as `docs/PLAN.md`: every naming decision, file format, function
signature, validation rule and acceptance test is already fixed. MUST and MUST NOT are not
preferences — a deviation fails review.

**Repository:** `D:\MyGitRepos\the-anchoring`
**Prerequisite:** `docs/PLAN.md` T1–T6 complete (commits `521b0da` … `c3236dc`, plus the
package-name fix `5376724`). Baseline: 196 tests, `kb verify --strict` clean, 12 entities.
**Read first:** `docs/PLAN.md` (§3 rules still bind, all ten), then `docs/THE_ANCHORING.md`.

---

## 0. The gap this closes

The Anchoring today enforces that a document's claim about code is **true** — anchors
resolve, references exist, hazards have sources. It states, in the spec's rule 3, that

> An `INV-` without a checker in `enforced_by` is a wish.

and `kb verify` enforces that the anchor resolves. But the tool **ships no checker**. Every
architectural rule an `INV-` might point at — dependency direction, no cycles, module entry
points, I/O out of the domain core, file size — has to be hand-written by each adopting
repository. In practice that means it is not written, and the slot stays empty.

The three things missing, in order of value:

| # | Missing | Consequence today |
|---|---|---|
| 1 | Generated architecture checkers | `enforced_by` points at nothing, or at a checker every adopter reinvents |
| 2 | An `AGENTS.md` telling an agent to use the four commands | an agent installs the tool and never runs `kb ctx`, so nothing is recorded |
| 3 | Machine-checked ownership | `owner:` is free text; nobody can answer "who owns this file" |

Layer 3 closes all three, and closes nothing else. §7 of `docs/PLAN.md` (out of scope)
still stands in full: no vector search, no build graph, no observability, no CI/CD
orchestration, no developer portal. The boundary of this package remains *"every claim
about the code is machine-checkable"*. Generating a checker is inside that boundary.
Running a deployment is not.

---

## 1. The governing design decision

**`the-anchoring` generates checker configuration. It never runs a checker, and it never
takes a checker as a dependency.**

This is the whole architecture of Layer 3, and every task below follows from it:

- `dependencies` stays exactly `{ "js-yaml": "^4.1.0" }`. ESLint and dependency-cruiser are
  **not** added — not as dependencies, not as peer dependencies, not as optional ones.
- `kb guards` writes two text files into the host repository. The host runs its own ESLint
  and its own dependency-cruiser, on its own schedule, with its own versions.
- Anything a generated file asserts must be re-derivable from `anchoring.config.json`, so a
  generated file that has drifted from its source is detectable — see T8's `--check`.

Why this shape and not "bundle a linter": a repository already owns its lint toolchain, its
versions and its CI. A tool that brings its own ESLint fights that toolchain within a week
and gets uninstalled. A tool that emits a config fragment composes with whatever is already
there and can be deleted without trace.

**Generated files are named `anchoring.*` and nothing else.** `kb guards` MUST NOT create,
edit, delete or read for merging any file the host owns — not `eslint.config.js`, not
`.dependency-cruiser.cjs`, not `package.json`. It writes `anchoring.guards.mjs` and
`anchoring.depcruise.cjs`, and it *prints* the one line the host must add to compose them.

**Scope: TypeScript/JavaScript only, for now.** The `architecture` block is language-neutral
in shape, but the two generators emit ESLint and dependency-cruiser config. A host with no
`package.json` gets a clear "guards are TypeScript/JavaScript only in this version" note and
no generated files — never a broken config. Language neutrality is deferred, deliberately;
it costs a generator per ecosystem and buys nothing until a non-JS repository actually
adopts this.

---

## 2. Tasks

T7 → T12, **strictly sequential**. Each ends with `npm run verify` green,
`npm run kb -- verify -- --strict` clean, and exactly one commit with the message given.

---

### T7 — The `architecture` block

**Goal:** put the dependency matrix in the config file, where a generator can read it.
Today it exists only as prose in somebody's head.

#### 7a. Format

A new optional top-level key in `anchoring.config.json`. **Absent means off** — every
existing config keeps working unchanged, and `kb guards` refuses with an instruction rather
than inventing a matrix.

```jsonc
{
  "architecture": {
    "layers": [
      { "name": "ui",     "paths": ["src/ui/", "apps/"] },
      { "name": "app",    "paths": ["src/app/"] },
      { "name": "domain", "paths": ["src/domain/", "packages/core/"], "pure": true },
      { "name": "infra",  "paths": ["src/infra/"] }
    ],
    "moduleRoots": ["src/modules/", "packages/"],
    "entryPoints": ["index.ts", "index.tsx", "index.js"],
    "maxFileLines": 400,
    "maxFunctionLines": 50,
    "impureImports": ["node:fs", "node:child_process", "node:http", "node:https", "node:crypto"]
  }
}
```

**Semantics — state these in a doc comment on the type, because they are the whole contract:**

- `layers` is **ordered, highest first**. A layer may import from itself and from any layer
  **below** it. Importing upward is forbidden. This is `docs/PLAN.md`-style one-way
  dependency, made checkable.
- A path may belong to exactly one layer. Overlapping paths across two layers is a config
  error — otherwise the direction of an import becomes ambiguous and the checker lies.
- `pure: true` marks the layer that may not perform I/O. At most one layer may be `pure`.
  Generated as an ESLint `no-restricted-imports` over `impureImports`.
- `moduleRoots` are directories whose immediate children are modules. A file outside module
  `X` may import from `X` only through one of `entryPoints`. This is the "privacy violation"
  rule — a deep import compiles fine and is exactly what makes internals unchangeable later.
- `maxFileLines` / `maxFunctionLines` are the lagging backstop, not the primary rule. Emit
  them as ESLint `max-lines` and `max-lines-per-function`, both with
  `skipBlankLines: true, skipComments: true`, and `max-lines-per-function` disabled for
  `*.test.*` / `*.spec.*` (a `describe` body is a suite to a reader and a callback to the
  AST; capping it measures nothing — this cost the upstream project six false findings out
  of its first seventeen).

**Defaults** when `architecture` is present but a field is absent: `layers: []`,
`moduleRoots: []`, `entryPoints: ["index.ts", "index.tsx", "index.js"]`,
`maxFileLines: 400`, `maxFunctionLines: 50`, `impureImports` as shown above.

#### 7b. Types and validation

Extend `src/config.ts`:

```ts
export interface Layer {
  readonly name: string
  readonly paths: readonly string[]     // repo-relative, POSIX, trailing slash
  readonly pure: boolean
}

export interface Architecture {
  readonly layers: readonly Layer[]
  readonly moduleRoots: readonly string[]
  readonly entryPoints: readonly string[]
  readonly maxFileLines: number
  readonly maxFunctionLines: number
  readonly impureImports: readonly string[]
}

// on AnchoringConfig:
readonly architecture?: Architecture   // absent when the key is absent
```

`exactOptionalPropertyTypes` is on — omit the property, never set it to `undefined`.

**Validation rules, each producing one entry in `problems`, phrased like the existing ones:**

- `architecture` is not an object
- an unknown key inside it → name it, list the accepted keys
- `layers` is not an array of objects, or a layer has no non-empty `name`
- two layers share a `name`
- a layer's `paths` is not a non-empty array of non-empty strings
- a path is absolute, contains `..`, or contains a backslash (same rule as `dir`) —
  **normalise** every path to a trailing `/`
- two layers claim the same path, or one layer's path is a prefix of another's
- more than one layer has `pure: true`
- `moduleRoots` / `entryPoints` / `impureImports` are not arrays of non-empty strings;
  normalise `moduleRoots` to a trailing `/`
- `maxFileLines` / `maxFunctionLines` are not positive integers
- `maxFileLines < 50` or `maxFunctionLines < 10` → reject with the hint that a threshold
  nobody can meet is a threshold that gets switched off

**Tests — extend `src/config.test.ts`, at least 14 new:** one per rule above, plus: absent
`architecture` leaves the property absent (not `undefined`); a minimal `{"layers":[]}` fills
every default; path normalisation adds the trailing slash; layer order is preserved verbatim.

**Acceptance:** existing 196 tests still green; `parseConfig` rejects every malformed shape
above with a message naming the offending key.

**Commit:** `feat(config): describe the dependency matrix in configuration`

---

### T8 — `kb guards`

**Goal:** turn the `architecture` block into two checker fragments, and detect when they
have drifted from it.

**Create `src/guards.ts`.** Same plan/apply split as `init.ts`, for the same reason — it is
what makes the generator testable without a real tree:

```ts
export interface GeneratedFile {
  readonly path: string        // repo-relative
  readonly body: string
}

export interface GuardsPlan {
  readonly files: readonly GeneratedFile[]
  readonly notes: readonly string[]
}

export function planGuards(config: AnchoringConfig): GuardsPlan
export function guardsHash(architecture: Architecture): string
export function checkGuards(plan: GuardsPlan, read: (path: string) => string | undefined):
  readonly { readonly path: string; readonly state: 'ok' | 'missing' | 'stale' | 'hand-edited' }[]
```

`planGuards` is **pure**: no filesystem, no clock, no process. It takes the resolved config
and returns file bodies. This is not negotiable — it is what lets fifteen generator tests run
in milliseconds and what keeps the generator honest.

#### 8a. The hash header

Every generated file starts with exactly this, `//` for `.mjs`/`.cjs`:

```
// GENERATED BY `kb guards` — DO NOT EDIT.
// Source of truth: anchoring.config.json → architecture
// kb-guards-hash: a1b2c3d4e5f60718
// Regenerate with: npx kb guards
```

`guardsHash` is a **pure, dependency-free FNV-1a over a canonical JSON serialisation** of the
`architecture` block — keys sorted, no whitespace, arrays in their declared order — folded to
16 hex characters. Do not import `node:crypto`; a hash for drift detection is arithmetic, and
keeping it arithmetic keeps `guards.ts` in the pure half of the codebase where
`INV-INJECTED-IO` applies.

`checkGuards` classifies each file:

| State | Meaning |
|---|---|
| `ok` | file exists, header hash equals `guardsHash(config.architecture)`, body equals the planned body |
| `missing` | file does not exist |
| `stale` | header hash differs — the config changed and nobody regenerated |
| `hand-edited` | header hash matches but the body does not — somebody edited a generated file |

`hand-edited` must be distinguished from `stale`. They are different mistakes with different
fixes, and collapsing them into "out of date" tells the reader nothing about which one they
made.

#### 8b. `anchoring.depcruise.cjs`

CommonJS, because dependency-cruiser configs are. Exports **only a rule array**, never a
whole config — the host composes it:

```js
module.exports = { forbidden: [ /* … */ ] }
```

Rules generated, each with a `name`, a `severity: 'error'`, and a `comment` that says *why*
in one sentence (the comment is what a developer reads when the build breaks; a rule that
fails with no reason gets suppressed):

1. `no-circular` — always emitted, even with no layers. Cycles are wrong in every
   architecture, and this rule needs no configuration to be correct.
2. `layer-<higher>-must-not-import-<lower>` — for **every ordered pair** where the second
   sits above the first: `from.path` = the lower layer's paths, `to.path` = the higher
   layer's paths. Emit one rule per pair, not one combined rule: a combined rule reports
   "layering violation" and a per-pair rule reports which direction was crossed.
3. `module-<root>-entry-only` — for each `moduleRoots` entry: forbid a path outside module
   `X` from importing a file inside `X` that is not one of `entryPoints`. Express with
   dependency-cruiser's `pathNot` on `to`, anchored so `packages/foo/index.ts` is allowed and
   `packages/foo/src/internal.ts` is not.
4. `no-orphans` is **not** emitted. It is noisy on a young repository and is a style opinion,
   not an invariant.

Emit `forbidden: []` with an explanatory comment when `layers` and `moduleRoots` are both
empty, rather than omitting the file — a file that exists and says "nothing configured yet"
is discoverable; an absent file is a mystery.

#### 8c. `anchoring.guards.mjs`

An ESLint **flat-config fragment**: a default-exported array the host spreads.

```js
export default [ /* … */ ]
```

Blocks generated:

1. `max-lines` / `max-lines-per-function` over every layer path and module root (or `**/*`
   when neither is configured), with the test-file exemption for
   `max-lines-per-function` described in T7.
2. For the `pure: true` layer, if any: `no-restricted-imports` with `patterns` =
   `impureImports`, each carrying a message naming the layer —
   `"<name> is the pure layer: pass the value in as an argument instead of importing <mod>."`
   Also emit `no-restricted-globals` for `Date`, `fetch`, `crypto` and
   `no-restricted-properties` for `Math.random` / `Date.now`, with the same message shape.
   Impurity that arrives through a global is exactly as damaging as impurity that arrives
   through an import, and only banning the import catches half of it.
3. Nothing else. No stylistic rules, no `recommended` presets, no formatting. The host owns
   style; this fragment owns architecture.

#### 8d. CLI

```
kb guards [--check] [--dry-run]
```

- no flags: write both files, print what was written and the compose instructions (8e).
  Exit `0`.
- `--check`: write nothing. Print one line per file with its state. Exit `0` when every file
  is `ok`; exit `1` otherwise. **This is the CI gate**, and it is the reason the hash exists.
- `--dry-run`: print the full body of each file to stdout, write nothing, exit `0`.
- `architecture` absent from the config: print
  `kb guards: no "architecture" block in anchoring.config.json — nothing to generate.`
  followed by a minimal example block, and exit `1`. Never invent a matrix.
- no `package.json` at the repo root: print
  `kb guards: generated checkers currently target TypeScript/JavaScript projects only.`
  and exit `1`. Write nothing.

#### 8e. The compose instructions

Printed after a successful write, and **only** as text:

```
Add these two lines to compose the guards with your own config:

  eslint.config.js         import anchoringGuards from './anchoring.guards.mjs'
                           export default [ ...anchoringGuards, /* your config */ ]

  .dependency-cruiser.cjs  const anchoring = require('./anchoring.depcruise.cjs')
                           forbidden: [ ...anchoring.forbidden, /* your rules */ ]

  CI                       npx kb guards --check && npx eslint . && npx depcruise src
```

`kb guards` MUST NOT perform these edits itself. See §1.

**Tests — new `src/guards.test.ts`, at least 18:**
- an empty `architecture` produces both files, `forbidden: []`, and the "nothing configured"
  comment
- four ordered layers produce exactly six ordered-pair rules, named for the direction crossed
- a two-layer config produces exactly one pair rule
- `pure` layer produces the restricted-imports/globals/properties block; no `pure` layer
  produces none
- `moduleRoots` produce one entry-only rule each; `entryPoints` appear in the generated
  pattern
- `max-lines` values come from config; `max-lines-per-function` is disabled for `*.test.*`
- the header appears verbatim in both files, with a 16-hex-character hash
- `guardsHash` is stable across key order in the source object (canonicalisation works)
- `guardsHash` changes when any architecture value changes — assert for each field
- `checkGuards` returns `ok` / `missing` / `stale` / `hand-edited` — one test each
- `--check` exits `1` on `stale` and on `hand-edited`, `0` when both files are `ok`
- `--dry-run` writes nothing (assert with an `InitIo` whose `writeFile` throws)
- missing `architecture` exits `1` and prints the example
- missing `package.json` exits `1` and writes nothing
- the generated `.mjs` is syntactically valid — parse it with a dynamic `import()` of a temp
  file and assert the default export is an array. A generator that emits a syntax error must
  fail here, not in the adopter's build.

**Acceptance:** `npx kb guards --dry-run` in this repository prints two valid files.
`npx kb guards && npx kb guards --check` exits `0` twice.

**Commit:** `feat(guards): generate architecture checkers from the dependency matrix`

---

### T9 — Starter invariants that point at the generated checkers

**Goal:** the `enforced_by` slot arrives filled.

**Add five templates** under `templates/invariants/`, each a complete, valid `INV-` document
with resolving anchors, written in the voice of the existing documents — what the rule is,
why it is load-bearing, what breaks when it is violated, and how it is checked:

| File | Invariant | `enforced_by` |
|---|---|---|
| `INV-NO-CYCLES.md` | the dependency graph is acyclic | `file:anchoring.depcruise.cjs` |
| `INV-DEP-DIRECTION.md` | dependencies point one way, down the layer order | `file:anchoring.depcruise.cjs`, `file:anchoring.config.json` |
| `INV-MODULE-ENTRY.md` | cross-module imports go through the module's entry point | `file:anchoring.depcruise.cjs` |
| `INV-PURE-CORE.md` | the pure layer performs no I/O; every non-deterministic input is an argument | `file:anchoring.guards.mjs` |
| `INV-FILE-SIZE.md` | files and functions stay under the configured ceiling | `file:anchoring.guards.mjs` |

Each `holds_for` the paths its rule covers, written by `kb init --guards` from the config.

**`kb init` gains `--guards`:**

1. Detect an `architecture` starter block: every directory that exists among
   `src/ui`, `src/app`, `src/domain`, `src/infra`, `src/core`, `packages/core`, `apps` maps
   to its conventional layer; `packages/` and `src/modules/` become `moduleRoots` when they
   exist. If nothing is detected, write `"layers": []` **with a note** telling the user to
   fill it in, and skip the five invariant documents — an invariant whose `holds_for` names
   nothing is inert, and writing it anyway teaches the reader that these documents are
   decoration.
2. Write the five `INV-` documents into `config.kinds.INV.dir`, with `holds_for` filled from
   the detected paths.
3. Run the T8 generation.
4. Print the compose instructions.

Without `--guards`, `kb init` behaves exactly as today. Do not change its default.

**Tests — extend `src/init.test.ts`, at least 8:** layer detection for each conventional
directory; `packages/` → `moduleRoots`; nothing detected → empty layers, the note, and no
`INV-` files; `--guards` writes exactly five `INV-` documents; every generated `INV-`
document passes `verify` with zero findings on the tree `init` just created; `--guards` in a
non-JS directory writes the config but no generated files, and says so; running
`init --guards` twice without `--force` still refuses.

**Acceptance:** in a fresh temp repo with `src/domain/` and `src/infra/`,
`kb init --guards && kb verify --strict` exits `0`, and `kb why src/domain` names
`INV-PURE-CORE` and `INV-FILE-SIZE`.

**Commit:** `feat(guards): ship the five starter invariants with their checkers`

---

### T10 — `AGENTS.md`

**Goal:** an agent that installs this tool must be told to use it. Today nothing tells it,
so `kb ctx` is never run and the session note is never written, and every downstream gate
falls silent.

**Create `templates/AGENTS.md`.** Portable — no project name, no repository-specific paths;
every path comes from the config at generation time. Structure, in this order:

1. **Cold start.** Before answering, planning, or editing: run `kb ctx W-<n>` for the work
   item. If you were not given one, ask for it or open one. There is no small-change
   exemption.
2. **Retrieval.** Before reading files by hand, run `kb why <file|symbol>`. Read what it
   names and stop there. If a structural index is configured, mention it; otherwise do not.
3. **While working.** Keep `touches:` current in the work item as you learn what the change
   reaches. Never write a derived field into a document.
4. **Before declaring done.** `kb done <W-id>` must be clean, `kb verify` must pass, and any
   `INV-` reachable from the work must still hold. Report failures with their output; never
   assert that something passed.
5. **The architecture rules**, generated from the `architecture` block: the layer order as an
   arrow diagram, the entry-point rule, the purity rule, the size ceilings — each with one
   sentence on *why*, and a pointer to the `INV-` that checks it. The ones a machine cannot
   check are stated here as prose and flagged as such: **UI and controllers only move data**;
   **one concept, one name, everywhere**; **split on two reasons to change, not on line
   count**.
6. **Never do these.** Edit a generated `anchoring.*` file. Loosen a threshold to make a
   check pass. Add a dependency to the pure layer. Record a work item as done with gaps
   outstanding.

`kb init` writes `AGENTS.md` at the repository root **only when no `AGENTS.md` exists**. If
one exists, leave it entirely alone and print the path of a suggested section to merge by
hand. Overwriting an existing `AGENTS.md` would destroy exactly the file most likely to
contain a project's hardest-won knowledge.

Section 5 is generated from the config, so it must be regenerated by `kb guards` too —
`kb guards` updates the block between two markers:

```
<!-- kb:architecture:start -->
…generated…
<!-- kb:architecture:end -->
```

and leaves every byte outside those markers untouched. If the markers are absent, print a
note; do not append.

**Tests — new `src/agents.test.ts`, at least 8:** the file is written when absent and not
when present; the marker block is replaced in place with surrounding text preserved verbatim;
absent markers produce a note and no write; the layer diagram matches the configured order;
an empty `architecture` produces the prose sections but no layer diagram; the generated file
contains no absolute paths and no host-specific names.

**Acceptance:** `AGENTS.md` exists at the root of this repository, its architecture block
matches this repository's own config, and re-running `kb guards` leaves the file
byte-identical.

**Commit:** `feat(agents): ship the agent brief that makes the commands actually get run`

---

### T11 — Ownership

**Goal:** answer "who owns this file" from the intent graph, which already knows.

1. Add `owner` to `SCALAR_FIELDS` for `WORK`, `ADR` and `INV`. Optional. A free string, but
   validated in shape: either `@handle` or `team:<name>`. Anything else is an error naming
   both accepted shapes — an ownership field that accepts anything identifies nobody.
2. New command `kb owners [--check]`:
   - with no flag: print a table of anchor path → owners, derived by walking every entity
     that has an `owner` and every `file:` anchor it carries, and write
     `CODEOWNERS` — at `.github/CODEOWNERS` when `.github/` exists, otherwise at the
     repository root — between the same marker pair as T10, so a hand-written CODEOWNERS
     survives.
   - `--check`: exit `1` when the generated block differs from the file on disk. CI gate.
   - Longest-matching-path wins when two entities claim overlapping anchors, and the losing
     claim is reported as a note, not silently dropped.
3. `kb why <path>` gains one line at the end when an owner is known: `owner: @handle (via W-12)`.

**Do not** add a `TEAM-` entity kind, a roster file, or ownership percentages. Ownership here
is a projection of data the graph already holds; the moment it needs its own storage it has
become a directory service, which is out of scope.

**Tests — new `src/owners.test.ts`, at least 10:** shape validation accepts `@handle` and
`team:x` and rejects three other shapes; a single owner over one anchor; two entities over
overlapping anchors → longest match wins, with the note; no owners anywhere → the command
says so and writes nothing; the marker block is preserved; `.github/CODEOWNERS` is preferred
when `.github/` exists; `--check` exits `1` on drift and `0` when in sync; `kb why` prints
the owner line only when an owner exists.

**Commit:** `feat(owners): project ownership out of the intent graph into CODEOWNERS`

---

### T12 — Dogfood Layer 3 on this repository

Everything below must be done with the shipped commands, not by hand.

1. Add an `architecture` block to this repository's own `anchoring.config.json`. This repo is
   flat, so be honest about it rather than inventing layers:

   ```jsonc
   "architecture": {
     "layers": [
       { "name": "cli",    "paths": ["src/cli.ts", "src/render.ts"] },
       { "name": "domain", "paths": ["src/verify.ts", "src/why.ts", "src/ctx.ts",
                                     "src/done.ts", "src/model.ts", "src/guards.ts"],
         "pure": true }
     ],
     "maxFileLines": 400,
     "maxFunctionLines": 50
   }
   ```

   If T7's "a path may belong to exactly one layer" rule makes a file-level path illegal,
   **fix the plan by restructuring the code, not by weakening the rule**: move the pure
   modules under `src/domain/` and the I/O modules under `src/io/`, and update the imports.
   That restructure is a legitimate outcome of this task and is preferable to a config that
   describes a shape the repository does not have.

2. `npx kb guards`. Compose the two fragments into `eslint.config.js` and a new
   `.dependency-cruiser.cjs` by hand, exactly as the printed instructions say. Add
   `dependency-cruiser` to **devDependencies only**.
3. Run the checkers. `src/config.ts` is 392 lines against a 400 ceiling — expect it to be
   the first thing that bites. **If a generated guard fails, fix the code. Never raise a
   threshold to make a check pass**; that is the failure mode this entire layer exists to
   prevent, and doing it in the tool's own repository would be self-refuting.
4. Replace the hand-written `INV-INJECTED-IO` with the generated `INV-PURE-CORE`, or
   re-anchor `INV-INJECTED-IO` at `file:anchoring.guards.mjs` so it is enforced by the
   generated rule rather than by a bespoke one. Keep `INV-CONFIG-THREADED` as it is — it
   guards something no generator produces.
5. `npx kb owners`, with `owner: @Mixerod` on the ADRs.
6. `npx kb init` is **not** re-run. Write `AGENTS.md` by invoking the T10 code path directly.
7. Add to `.github/workflows/ci.yml`, in this order:
   `npx kb guards --check`, `npx kb owners --check`, `npx eslint .`,
   `npx depcruise src`, `npm run kb -- verify -- --strict`.
8. Work items `W-7` … `W-12`, one per task, `status: done`, real `implements` and `touches`.

**Acceptance:**
- `npx kb guards --check` and `npx kb owners --check` both exit `0`
- `npx eslint .` and `npx depcruise src` both pass with the generated rules composed in
- `npm run kb -- verify -- --strict` exits `0`
- `npm run kb -- why src/verify.ts` names an ADR, an invariant and an owner
- deleting `anchoring.guards.mjs` makes `kb guards --check` exit `1` with `missing`;
  editing one line of it makes it exit `1` with `hand-edited`. Verify both by hand and
  restore.

**Commit:** `docs: enforce this repository's own architecture with its own guards`

---

## 3. Definition of done

- [ ] `npm run verify` green; `npm run build` green
- [ ] test count ≥ 260, line coverage ≥ 95%
- [ ] `dependencies` is exactly `{ "js-yaml": "^4.1.0" }` — ESLint and dependency-cruiser
      appear only under `devDependencies`, and neither under `peerDependencies`
- [ ] **No import of ESLint or dependency-cruiser outside `*.test.ts`.** Restated on
      2026-08-28: the original wording banned the import "anywhere", and
      `src/invariants.test.ts` imports `ESLint` because this plan itself required a test
      proving the generated rule fires. The rule was too broadly worded, not the code —
      the tool must never *run* a checker, and a test that runs one to prove the generated
      config is real is exactly what makes that claim checkable. In `src/*.ts` that is not
      a test, `grep -rn "eslint\|dependency-cruiser"` must still find only string literals
      inside the generators.
- [ ] `planGuards` and `guardsHash` are pure: `grep -n "node:fs\|node:child_process\|node:crypto\|new Date" src/guards.ts` → no matches
- [ ] `kb guards --check`, `kb owners --check` exit `0` on this repository
- [ ] a fresh temp repo: `kb init --guards && kb verify --strict && kb guards --check` all exit `0`
- [ ] no file in `src/` exceeds the configured `maxFileLines`
- [ ] no generated `anchoring.*` file was hand-edited at any point
- [ ] nothing published, pushed, or given a git remote
- [ ] `D:\MyGitRepos\dicebound` untouched

## 4. Still out of scope

Everything in `docs/PLAN.md` §7, unchanged, plus:

- Running ESLint, dependency-cruiser, or any checker from inside this tool.
- Generators for non-JS ecosystems (import-linter, ArchUnit, Packwerk). The `architecture`
  block is shaped so they can be added later; adding one now costs a generator and buys
  nothing until a non-JS repository adopts this.
- Auto-fixing an architecture violation. The tool reports; a human or an agent decides.
- Editing `eslint.config.js`, `.dependency-cruiser.cjs`, `package.json`, or any file the host
  owns. Composition is printed, never performed.
- A `TEAM-` entity kind, a roster, or anything that turns ownership into its own store.
- Branching strategy, merge queues, release management, observability, build caching,
  developer portals. Adjacent, genuinely useful, and not this tool's job.
