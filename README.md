# The Anchoring

**An intent graph in git, anchored to code, machine-checked.**

Documentation floats free of code, is written once, drifts within weeks, and nothing notices. Anchoring ties every claim a document makes to a specific, machine-checkable anchor in the code, so that when the code moves, the claim fails loudly instead of quietly becoming fiction.

Read [`docs/THE_ANCHORING.md`](docs/THE_ANCHORING.md) for the architectural pattern and rationale.

---

## 60-Second Quickstart

### 1. Install & Initialize

```bash
npm install -D the-anchoring
# or: pnpm add -D the-anchoring
```

Bootstrap the intent graph in your repository root:

```bash
npx kb init
```

This creates:
- `anchoring.config.json`
- `.anchor/` with directories for `invariant/`, `flow/`, `work/`, `incident/`, `hazard/`, and `session/`
- Standard starter templates (`0000-template.md`)

### 2. Verify

```bash
npx kb verify
```

### 3. Protect Your Intent Graph (The Three Gates)

1. **Stop Hook (AI Agent Session Guard)**: Add to `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "npx kb done --check",
               "timeout": 20
             }
           ]
         }
       ]
     }
   }
   ```

2. **Pre-commit Hook**: In your git hooks (e.g. Husky or `.githooks/pre-commit`):
   ```bash
   npx kb verify
   ```

3. **CI Gate**: In your CI workflow:
   ```bash
   npx kb verify --strict
   ```

---

## The Six Entity Kinds

| Kind | Prefix | Purpose | Links To |
|---|---|---|---|
| **ADR** | `ADR-` | Architectural decisions and context | Code (`governs`), Invariants (`constrains`), Tests (`verified_by`), ADR (`supersedes`) |
| **Invariant** | `INV-` | Non-negotiable rules that must hold | Checks (`enforced_by`), Code (`holds_for`) |
| **Flow** | `FLOW-` | User/system journeys across features | Code (`served_by`), ADR (`decided_by`) |
| **Work** | `W-` | Active and past tasks | ADR (`implements`), Code (`touches`), Incidents (`closes`), Work (`blocked_by`) |
| **Incident** | `INC-` | Post-mortems and bug root causes | Invariant (`violates`), Code (`found_in`, `touches`), Work (`closed_by`, `promoted_to`) |
| **Hazard** | `HAZ-` | External failure modes that could recur | Code/Symbols (`holds_for`), ADR/INV (`resolves_to`) |

---

## Commands

```bash
npx kb ctx <W-id>              # progressive disclosure: all context that bears on a task
npx kb why <path|symbol|id>    # reverse walk: what this code or entity is for
npx kb done <W-id>             # closing check: diff vs claims
npx kb verify [--strict]       # machine check every claim across the repository
npx kb skills                  # what agent skills cost, and which ones the graph justifies
```

### Agent skills (`kb skills`)

If your repository delivers agent skills through the
[@skills protocol](https://github.com/SylphAI-Inc/atskills) — a `.atskills/` directory and a
`.atskills/.autotrigger` file — `kb skills` weighs what that costs and checks it against the
intent graph.

Only `.autotrigger` lines cost resident prompt tokens, and the protocol's own recommendation
is to keep them under ten. This command prints that budget with a token estimate, and warns
about every resident skill that **no document anchors**:

```
Tier 3 - .atskills/.autotrigger (2 skills, ~34 tok/message, estimated at 4 bytes/token)
  [ok]   team-flows/deploy  ~21 tok  <- W-16
  [warn] team-flows/review  ~13 tok  <- nothing in the graph anchors it
```

A skill earns its residency the same way anything else in this repository does: a document
says why. Anchor it from a work item, invariant, or decision with an ordinary `file:` anchor —
no new anchor form is involved, because a skill folder is an ordinary path:

```yaml
touches:
  - file:.atskills/team-flows/deploy
```

**`kb skills` never writes.** `.atskills/` belongs to your project and to the protocol, not to
this tool, so a suggested line is printed for you to paste. The check is advisory and always
exits 0: a gate that blocks on bookkeeping is one you switch off within a week.

## License

[MIT](LICENSE)

---

## Engineering Knowledge Packs

Cross-repository invariants, hazards, and doctrine are distributed as **packs**:

```bash
npx kb pack list                     # view available packs
npx kb pack add discipline           # seed the discipline pack into .anchor/
npx kb pack check                    # verify that seeded knowledge has not drifted
```

The built-in `discipline` pack (`templates/packs/discipline/`) packages module boundaries, credential safety, and agent verification discipline so any repository can adopt them.
