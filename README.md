# The Anchoring

**An intent graph in git, anchored to code, machine-checked.**

Documentation floats free of code, is written once, drifts within weeks, and nothing notices. Anchoring ties every claim a document makes to a specific, machine-checkable anchor in the code, so that when the code moves, the claim fails loudly instead of quietly becoming fiction.

Read [`docs/THE_ANCHORING.md`](docs/THE_ANCHORING.md) for the architectural pattern and rationale.

---

## 60-Second Quickstart

### 1. Install & Initialize

```bash
npm install -D @andru/the-anchoring
# or: pnpm add -D @andru/the-anchoring
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
```

## License

[MIT](LICENSE)
